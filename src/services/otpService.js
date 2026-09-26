/**
 * OTP Service - Handles OTP generation and verification
 * Reuses the existing otp_verifications table (shared with mobile app)
 */

import { supabase } from '../supabaseClient'

/**
 * Generate a random 6-digit OTP
 */
export function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

/**
 * Request OTP for email - creates a new OTP record and sends email
 * Supports the web admin email login (login_method='email')
 */
export async function requestOTP(email, userId) {
  try {
    const { data, error } = await supabase.functions.invoke('send-otp-email', {
      body: {
        email,
        userId,
      },
    })

    if (error) throw error

    const otpRecord = data?.otpRecord

    return {
      success: true,
      otpId: otpRecord?.id || null,
      message: `OTP sent to ${email}`,
    }
  } catch (error) {
    console.error('Error requesting OTP:', error)
    throw error
  }
}

/**
 * Verify OTP code
 * Works with the existing table structure
 */
export async function verifyOTP(email, otpCode) {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: otpCode,
      type: 'email',
    })

    if (error) throw error

    return {
      success: true,
      session: data?.session || null,
      user: data?.user || null,
      message: 'OTP verified successfully',
    }
  } catch (error) {
    console.error('Error verifying OTP:', error)
    throw error
  }
}

/**
 * Resend OTP for email login
 */
export async function resendOTP(email, userId) {
  try {
    // Request new OTP
    return await requestOTP(email, userId)
  } catch (error) {
    console.error('Error resending OTP:', error)
    throw error
  }
}

/**
 * Clean up expired OTPs (both email and SMS)
 * Optional: Run periodically as a scheduled task
 */
export async function cleanupExpiredOTPs() {
  try {
    const { error } = await supabase
      .from('otp_verifications')
      .delete()
      .lt('expires_at', new Date().toISOString())
      .lt('created_at', new Date(Date.now() - 86400000).toISOString()) // Older than 1 day

    if (error) throw error

    return { success: true, message: 'Expired OTPs cleaned up' }
  } catch (error) {
    console.error('Error cleaning up expired OTPs:', error)
    throw error
  }
}
