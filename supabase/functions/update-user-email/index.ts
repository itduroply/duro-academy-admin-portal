import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UpdateEmailRequest {
  userId: string
  email: string
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token || token === 'undefined' || token === 'null') {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: authError?.message || 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: actor, error: actorError } = await supabaseAdmin
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (actorError || !['admin', 'super_admin'].includes(actor?.role)) {
      return new Response(
        JSON.stringify({ error: 'Forbidden: Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body: UpdateEmailRequest = await req.json()
    const userId = String(body?.userId || '').trim()
    const nextEmail = String(body?.email || '').trim().toLowerCase()

    if (!userId || !nextEmail) {
      return new Response(
        JSON.stringify({ error: 'Missing userId or email' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!isValidEmail(nextEmail)) {
      return new Response(
        JSON.stringify({ error: 'Invalid email format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: existingProfile, error: profileReadError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('id', userId)
      .single()

    if (profileReadError || !existingProfile) {
      return new Response(
        JSON.stringify({ error: 'User not found in public.users' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const previousEmail = String(existingProfile.email || '').trim().toLowerCase()
    if (previousEmail === nextEmail) {
      return new Response(
        JSON.stringify({ success: true, message: 'Email is unchanged' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { data: duplicateUser, error: duplicateError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', nextEmail)
      .neq('id', userId)
      .maybeSingle()

    if (duplicateError) {
      return new Response(
        JSON.stringify({ error: duplicateError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (duplicateUser) {
      return new Response(
        JSON.stringify({ error: 'A user with this email address already exists.' }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email: nextEmail,
      email_confirm: true,
    })

    if (authUpdateError) {
      return new Response(
        JSON.stringify({ error: authUpdateError.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { error: profileUpdateError } = await supabaseAdmin
      .from('users')
      .update({ email: nextEmail })
      .eq('id', userId)

    if (profileUpdateError) {
      // Best effort rollback to avoid auth/profile mismatch.
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        email: previousEmail,
        email_confirm: true,
      })

      return new Response(
        JSON.stringify({ error: `Failed to update public.users email: ${profileUpdateError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Email updated successfully' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error in update-user-email function:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
