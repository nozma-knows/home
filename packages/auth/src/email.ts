import { Resend } from "resend";

type AuthenticationOTPType = "sign-in" | "email-verification" | "forget-password" | "change-email";

type SendAuthenticationOTPOptions = {
  apiKey?: string;
  email: string;
  from?: string;
  otp: string;
  type: AuthenticationOTPType;
};

const emailCopy: Record<AuthenticationOTPType, { heading: string; subject: string }> = {
  "sign-in": {
    heading: "Your sign-in code",
    subject: "Your home sign-in code",
  },
  "email-verification": {
    heading: "Verify your email",
    subject: "Verify your home email",
  },
  "forget-password": {
    heading: "Reset your password",
    subject: "Your home password reset code",
  },
  "change-email": {
    heading: "Confirm your new email",
    subject: "Confirm your home email change",
  },
};

export async function sendAuthenticationOTP({
  apiKey,
  email,
  from,
  otp,
  type,
}: SendAuthenticationOTPOptions) {
  if (!apiKey || !from) {
    throw new Error(
      "RESEND_API_KEY and RESEND_FROM_EMAIL are required to send authentication codes",
    );
  }

  const copy = emailCopy[type];
  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to: email,
    subject: copy.subject,
    text: `${copy.heading}: ${otp}. This code expires in 10 minutes. If you did not request it, you can ignore this email.`,
    html: `
      <div style="background:#09090b;color:#e4e4e7;font-family:Arial,sans-serif;padding:40px 20px">
        <div style="background:#18181b;border:1px solid #27272a;border-radius:16px;margin:0 auto;max-width:440px;padding:32px">
          <p style="color:#34d399;font-size:12px;font-weight:700;letter-spacing:0.18em;margin:0 0 16px;text-transform:uppercase">home</p>
          <h1 style="color:#fafafa;font-size:24px;margin:0 0 12px">${copy.heading}</h1>
          <p style="color:#a1a1aa;font-size:15px;line-height:24px;margin:0 0 24px">Enter this code to continue. It expires in 10 minutes.</p>
          <div style="background:#09090b;border:1px solid #3f3f46;border-radius:12px;color:#fafafa;font-family:monospace;font-size:32px;font-weight:700;letter-spacing:0.24em;padding:18px;text-align:center">${otp}</div>
          <p style="color:#71717a;font-size:13px;line-height:20px;margin:24px 0 0">If you did not request this code, you can safely ignore this email.</p>
        </div>
      </div>
    `,
  });

  if (error) {
    throw new Error(`Resend could not send the authentication code: ${error.message}`);
  }
}
