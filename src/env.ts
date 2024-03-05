export const isDevelopment = process.env.NODE_ENV !== "production";

export const env = (() => {
    const port = process.env.PORT && Number.parseInt(process.env.PORT, 10) || 8080;
    const host = process.env.HOST || undefined;

    return {
        PORT: port,
        HOST: host,
    };
})();
