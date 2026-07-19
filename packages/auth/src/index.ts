import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDatabase, schema } from "@home/db";
import { betterAuth } from "better-auth";
import { emailOTP, organization } from "better-auth/plugins";

import { sendAuthenticationOTP } from "./email";
import { getAuthEnvironment } from "./env";

const environment = getAuthEnvironment();

export const auth = betterAuth({
  appName: "home",
  baseURL: environment.baseURL,
  secret: environment.secret,
  database: drizzleAdapter(getDatabase(), {
    provider: "pg",
    schema,
  }),
  emailAndPassword: { enabled: false },
  socialProviders:
    environment.googleClientId && environment.googleClientSecret
      ? {
          google: {
            clientId: environment.googleClientId,
            clientSecret: environment.googleClientSecret,
            prompt: "select_account",
          },
        }
      : {},
  trustedOrigins: environment.trustedOrigins,
  user: {
    modelName: "users",
  },
  session: {
    modelName: "sessions",
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
  account: {
    modelName: "accounts",
    encryptOAuthTokens: true,
  },
  verification: {
    modelName: "verifications",
  },
  advanced: {
    cookiePrefix: "home",
    defaultCookieAttributes: environment.crossSiteCookies
      ? {
          sameSite: "none",
          secure: true,
          partitioned: true,
        }
      : undefined,
    crossSubDomainCookies: environment.cookieDomain
      ? {
          enabled: true,
          domain: environment.cookieDomain,
        }
      : { enabled: false },
  },
  plugins: [
    emailOTP({
      allowedAttempts: 5,
      expiresIn: 10 * 60,
      otpLength: 6,
      rateLimit: {
        max: 3,
        window: 60,
      },
      storeOTP: "hashed",
      async sendVerificationOTP({ email, otp, type }) {
        await sendAuthenticationOTP({
          apiKey: environment.resendApiKey,
          email,
          from: environment.resendFromEmail,
          otp,
          type,
        });
      },
    }),
    organization({
      membershipLimit: 250,
      schema: {
        organization: {
          modelName: "organizations",
        },
        member: {
          modelName: "userOrganizations",
        },
        invitation: {
          modelName: "organizationInvitations",
        },
      },
    }),
  ],
});

export type Auth = typeof auth;
