export type Env = {
  Bindings: {
    DB: D1Database;
    MEDIA: R2Bucket;
    ASSETS: Fetcher;
    APP_ORIGIN: string;
    BOOTSTRAP_SECRET: string;
    CONFIG_ENCRYPTION_KEY: string;
  };
  Variables: { userId: string };
};
