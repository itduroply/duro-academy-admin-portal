-- Create OTP Verifications Table for Email OTP Login
-- This table stores OTP codes sent to users for authentication

CREATE TABLE IF NOT EXISTS otp_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR NOT NULL,
  otp_code VARCHAR(6) NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  attempts INT DEFAULT 0,
  max_attempts INT DEFAULT 5,
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '10 minutes',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_otp_verifications_email 
ON otp_verifications(email);

CREATE INDEX IF NOT EXISTS idx_otp_verifications_user_id 
ON otp_verifications(user_id);

CREATE INDEX IF NOT EXISTS idx_otp_verifications_created_at 
ON otp_verifications(created_at);

-- Create a unique index to ensure only one active OTP per email
CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_verifications_email_active 
ON otp_verifications(email) 
WHERE is_verified = FALSE AND expires_at > NOW();

-- Enable Row Level Security
ALTER TABLE otp_verifications ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies
-- Allow users to view their own OTP records
DROP POLICY IF EXISTS "Users can view own otp records" ON otp_verifications;
CREATE POLICY "Users can view own otp records"
ON otp_verifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Allow admins and super_admins to read all otp_verifications records
DROP POLICY IF EXISTS "Admin full access otp_verifications" ON otp_verifications;
CREATE POLICY "Admin full access otp_verifications"
ON otp_verifications
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('admin', 'super_admin')
  )
);

-- Allow service role to insert and update OTP records (for backend operations)
DROP POLICY IF EXISTS "Service role manage otp verifications" ON otp_verifications;
CREATE POLICY "Service role manage otp verifications"
ON otp_verifications
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Create updated_at trigger
DROP TRIGGER IF EXISTS update_otp_verifications_updated_at ON otp_verifications;

CREATE OR REPLACE FUNCTION update_otp_verifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_otp_verifications_updated_at 
BEFORE UPDATE ON otp_verifications 
FOR EACH ROW 
EXECUTE FUNCTION update_otp_verifications_updated_at();

-- Create function to clean up expired OTP records (optional - run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_otp_verifications()
RETURNS void AS $$
BEGIN
  DELETE FROM otp_verifications
  WHERE expires_at < NOW() - INTERVAL '1 day';
END;
$$ LANGUAGE plpgsql;
