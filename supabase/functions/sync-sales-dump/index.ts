import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-secret",
}

const JOB_NAME = "sales_dump_monthly_mirror"
const DEBOUNCE_MS = 60_000
const PAGE_SIZE = 1000
const INSERT_BATCH_SIZE = 500

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function monthStartIso() {
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0))
  return monthStart.toISOString().slice(0, 10)
}

function tomorrowIso() {
  const now = new Date()
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0))
  return tomorrow.toISOString().slice(0, 10)
}

async function fetchSourceRows(sourceClient: ReturnType<typeof createClient>, sourceTable: string, startDate: string, endDateExclusive: string) {
  const allRows: Record<string, unknown>[] = []
  let from = 0
  let keepGoing = true

  while (keepGoing) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await sourceClient
      .from(sourceTable)
      .select("*")
      .gte("posting_date", startDate)
      .lt("posting_date", endDateExclusive)
      .order("posting_date", { ascending: true, nullsFirst: false })
      .range(from, to)

    if (error) {
      throw new Error(`Source fetch failed: ${error.message}`)
    }

    if (!data || data.length === 0) {
      keepGoing = false
      break
    }

    allRows.push(...data)
    from += PAGE_SIZE

    if (data.length < PAGE_SIZE) {
      keepGoing = false
    }
  }

  return allRows
}

function sanitizeForTargetInsert(rows: Record<string, unknown>[]) {
  return rows.map((row) => {
    const copy = { ...row }
    delete copy.id
    delete copy.upload_session_id
    return {
      ...copy,
      upload_session_id: null,
    }
  })
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const webhookSecret = Deno.env.get("SYNC_WEBHOOK_SECRET")
    const incomingSecret = req.headers.get("x-webhook-secret")
    if (webhookSecret && incomingSecret !== webhookSecret) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const sourceUrl = Deno.env.get("SOURCE_SUPABASE_URL")
    const sourceReadKey = Deno.env.get("SOURCE_SUPABASE_READ_KEY")
    const sourceTable = Deno.env.get("SOURCE_SALES_TABLE") || "sales_dump"
    const targetTable = Deno.env.get("TARGET_SALES_TABLE") || "sales_dump"

    const targetUrl = Deno.env.get("SUPABASE_URL")
    const targetServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!sourceUrl || !sourceReadKey || !targetUrl || !targetServiceRoleKey) {
      return new Response(JSON.stringify({ error: "Missing required function secrets" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const sourceClient = createClient(sourceUrl, sourceReadKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const targetAdmin = createClient(targetUrl, targetServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const debounceToken = crypto.randomUUID()

    const { error: stateWriteError } = await targetAdmin
      .from("cross_project_sync_state")
      .upsert({
        job_name: JOB_NAME,
        last_event_at: new Date().toISOString(),
        last_event_token: debounceToken,
      }, { onConflict: "job_name" })

    if (stateWriteError) {
      return new Response(JSON.stringify({ error: `Failed to write debounce state: ${stateWriteError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    await sleep(DEBOUNCE_MS)

    const { data: stateRow, error: stateReadError } = await targetAdmin
      .from("cross_project_sync_state")
      .select("job_name,last_event_token,is_running,running_since")
      .eq("job_name", JOB_NAME)
      .single()

    if (stateReadError || !stateRow) {
      return new Response(JSON.stringify({ error: "Failed to read debounce state" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (stateRow.last_event_token !== debounceToken) {
      return new Response(JSON.stringify({ success: true, status: "debounced_out" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const lockTimeoutIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const { data: lockRow, error: lockError } = await targetAdmin
      .from("cross_project_sync_state")
      .update({
        is_running: true,
        running_since: new Date().toISOString(),
      })
      .eq("job_name", JOB_NAME)
      .or(`is_running.eq.false,running_since.lt.${lockTimeoutIso}`)
      .select("job_name")
      .maybeSingle()

    if (lockError) {
      return new Response(JSON.stringify({ error: `Failed to acquire lock: ${lockError.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (!lockRow) {
      return new Response(JSON.stringify({ success: true, status: "already_running" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    const startedAt = new Date().toISOString()
    let status = "success"
    let sourceRows = 0
    let insertedRows = 0
    let deletedRows = 0
    let errorMessage: string | null = null

    try {
      const startDate = monthStartIso()
      const endDateExclusive = tomorrowIso()

      const sourceData = await fetchSourceRows(sourceClient, sourceTable, startDate, endDateExclusive)
      sourceRows = sourceData.length

      if (sourceRows === 0) {
        status = "skipped_zero_source"
      } else {
        const { data: deleted, error: deleteError } = await targetAdmin
          .from(targetTable)
          .delete()
          .gte("posting_date", startDate)
          .lt("posting_date", endDateExclusive)
          .select("id")

        if (deleteError) {
          throw new Error(`Target delete failed: ${deleteError.message}`)
        }

        deletedRows = Array.isArray(deleted) ? deleted.length : 0

        const rowsToInsert = sanitizeForTargetInsert(sourceData)
        const totalBatches = Math.ceil(rowsToInsert.length / INSERT_BATCH_SIZE)

        for (let i = 0; i < totalBatches; i += 1) {
          const batch = rowsToInsert.slice(i * INSERT_BATCH_SIZE, (i + 1) * INSERT_BATCH_SIZE)
          const { error: insertError } = await targetAdmin
            .from(targetTable)
            .insert(batch)

          if (insertError) {
            throw new Error(`Target insert failed in batch ${i + 1}: ${insertError.message}`)
          }

          insertedRows += batch.length
        }
      }
    } catch (err) {
      status = "failed"
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    const finishedAt = new Date().toISOString()

    await targetAdmin
      .from("cross_project_sync_runs")
      .insert({
        job_name: JOB_NAME,
        started_at: startedAt,
        finished_at: finishedAt,
        status,
        source_row_count: sourceRows,
        deleted_row_count: deletedRows,
        inserted_row_count: insertedRows,
        error_message: errorMessage,
      })

    await targetAdmin
      .from("cross_project_sync_state")
      .update({
        is_running: false,
        running_since: null,
      })
      .eq("job_name", JOB_NAME)

    if (status === "failed") {
      return new Response(JSON.stringify({
        success: false,
        status,
        sourceRows,
        deletedRows,
        insertedRows,
        error: errorMessage,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({
      success: true,
      status,
      sourceRows,
      deletedRows,
      insertedRows,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
