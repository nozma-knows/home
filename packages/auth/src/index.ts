import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDatabase, schema } from "@home/db";
import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

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
  emailAndPassword: {
    enabled: true,
  },
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
