import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.117.2';

interface EmailLoginRequest {
  email?: string;
  password?: string;
  otp?: string;
  userId?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTPEmail(email: string, otp: string, fullName?: string): Promise<void> {
  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  const isLocalDev = Deno.env.get('APP_ENV') === 'development' || Deno.env.get('NODE_ENV') === 'development' || Deno.env.get('DENO_ENV') === 'development';

  if (!resendApiKey) {
    if (isLocalDev) {
      console.warn(`[DEV MODE] RESEND_API_KEY missing. OTP for ${email}: ${otp}`);
      return;
    }
    throw new Error('RESEND_API_KEY is not configured');
  }

  const from = Deno.env.get('RESEND_FROM_EMAIL') || 'onboarding@resend.dev';
  const name = fullName?.trim() || 'there';

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      bcc: ['it.duroply@gmail.com'],
      subject: 'Your DuroAcademy Login OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px; color: #111827;">
          <h2 style="margin: 0 0 16px; color: #dc2626;">DuroAcademy</h2>
          <p style="margin: 0 0 12px;">Hi ${name},</p>
          <p style="margin: 0 0 20px;">Your verification code is:</p>
          <div style="background: #f3f4f6; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${otp}</span>
          </div>
          <p style="margin: 0; color: #6b7280; font-size: 14px;">This code will expire in 10 minutes. Never share it with anyone.</p>
          <p style="margin-top: 20px; color: #6b7280; font-size: 14px;">— Team DURO</p>
        </div>
      `,
      text: `Hi ${name},\n\nYour DuroAcademy verification code is: ${otp}\n\nThis code will expire in 10 minutes. Never share it with anyone.`,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    console.error('Resend API error:', responseText);

    if (isLocalDev) {
      console.warn(`[DEV MODE] OTP for ${email}: ${otp}`);
      return;
    }

    throw new Error('Failed to send OTP email');
  }
}

function extractOtpValue(data: any): string | null {
  return (
    data?.properties?.email_otp ||
    data?.email_otp ||
    data?.properties?.otp ||
    data?.otp ||
    null
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Partial<EmailLoginRequest>;
    const email = body.email?.toLowerCase().trim();
    const userId = body.userId;

    if (!email) {
      return jsonResponse({ success: false, error: 'Email is required' }, 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonResponse({ success: false, error: 'Invalid email format' }, 400);
    }

    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, employee_id, full_name, phone, role')
      .eq('email', email)
      .maybeSingle();

    if (userError || !user) {
      return jsonResponse({ success: false, error: 'No account found with this email' }, 401);
    }

    if (userId && userId !== user.id) {
      return jsonResponse({ success: false, error: 'Account lookup mismatch' }, 400);
    }

    const { data: generatedLink, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    });

    if (linkError) {
      console.error('OTP generation failed:', linkError);
      return jsonResponse({ success: false, error: 'Failed to generate OTP. Please try again.' }, 500);
    }

    const generatedOtp = extractOtpValue(generatedLink);
    if (!generatedOtp) {
      return jsonResponse({ success: false, error: 'Failed to generate OTP. Please try again.' }, 500);
    }

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const otpPayload = {
      user_id: user.id,
      employee_id: user.employee_id || `email_${user.id}`,
      phone: user.phone || '',
      login_email: user.email,
      otp: generatedOtp,
      login_method: 'email',
      expires_at: expiresAt,
      is_verified: false,
      attempts: 0,
      max_attempts: 3,
    };

    const { error: otpInsertError } = await supabaseAdmin
      .from('otp_verifications')
      .insert(otpPayload);

    if (otpInsertError) {
      console.error('OTP insert failed:', otpInsertError);
      return jsonResponse({ success: false, error: 'Failed to generate OTP. Please try again.' }, 500);
    }

    try {
      await sendOTPEmail(user.email, generatedOtp, user.full_name);
    } catch (sendError) {
      console.error('Email send failed:', sendError);
      return jsonResponse({
        success: false,
        error: 'OTP was created but email delivery failed. Please try again.',
      }, 500);
    }

    return jsonResponse({
      success: true,
      message: 'OTP sent to email',
      data: {
        userId: user.id,
        employeeId: user.employee_id,
        email: user.email,
        expiresAt,
        loginMethod: 'email',
      },
    });
  } catch (error) {
    console.error('Unhandled error:', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Internal server error',
    }, 500);
  }
});
