export { type ApiDependencies, createApi } from "./app";
export type AppType = ReturnType<typeof import("./app").createApi>;
