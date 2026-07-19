import { expect, it } from "bun:test";

import { sendAuthenticationOTP } from "./email";

it("refuses to send authentication codes without configured Resend credentials", async () => {
  await expect(
    sendAuthenticationOTP({
      email: "person@example.com",
      otp: "123456",
      type: "sign-in",
    }),
  ).rejects.toThrow("RESEND_API_KEY and RESEND_FROM_EMAIL are required");
});
