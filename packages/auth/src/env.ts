export function getAuthEnvironment() {
  const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";
  const webURL = process.env.WEB_URL ?? "http://localhost:3000";
  const secret = process.env.BETTER_AUTH_SECRET;

  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required");
  }

  const additionalOrigins = (process.env.ADDITIONAL_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    baseURL,
    cookieDomain: process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined,
    crossSiteCookies: process.env.AUTH_CROSS_SITE_COOKIES === "true",
    secret,
    trustedOrigins: [webURL, ...additionalOrigins],
  };
}
