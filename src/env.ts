export const isDevelopment = process.env.NODE_ENV !== "production";

export const env = (() => {
    const port = process.env.PORT && Number.parseInt(process.env.PORT, 10) || 8080;
    const host = process.env.HOST || undefined;

    return {
        ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || "the secret sauce",
        PORT: port,
        HOST: host,
    };
})();
