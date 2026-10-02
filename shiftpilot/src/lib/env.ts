function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  databaseUrl: opt("DATABASE_URL"),
  dashboardPassword: opt("DASHBOARD_PASSWORD"),

  openrouterKey: opt("OPENROUTER_API_KEY"),
  llmModel: opt("LLM_MODEL") ?? "openai/gpt-6-sol",
  jevModel: opt("JEV_MODEL") ?? "typesafe/jev-1.13",
  /** "jev_then_llm" (default), "jev", or "llm" */
  understandingMode: (opt("UNDERSTANDING_MODE") ?? "jev_then_llm") as "jev_then_llm" | "jev" | "llm",

  whatsapp: {
    token: opt("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: opt("WHATSAPP_PHONE_NUMBER_ID"),
    appSecret: opt("WHATSAPP_APP_SECRET"),
    verifyToken: opt("WHATSAPP_VERIFY_TOKEN"),
    graphVersion: opt("WHATSAPP_GRAPH_VERSION") ?? "v23.0",
    templateName: opt("WHATSAPP_TEMPLATE_NAME") ?? "hello_world",
    templateLang: opt("WHATSAPP_TEMPLATE_LANG") ?? "en_US",
    /** Set to "true" when the template has one {{1}} body variable that can carry the message text. */
    templateHasBodyParam: opt("WHATSAPP_TEMPLATE_HAS_BODY_PARAM") === "true",
  },

  sheets: {
    clientEmail: opt("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
    privateKey: opt("GOOGLE_PRIVATE_KEY")?.replace(/\\n/g, "\n"),
    spreadsheetId: opt("GOOGLE_SHEET_ID"),
    tab: opt("GOOGLE_SHEET_TAB") ?? "Roster",
  },

  tickIntervalSeconds: Number(opt("AGENT_TICK_SECONDS") ?? 30),
};

export const integrations = {
  whatsapp: Boolean(env.whatsapp.token && env.whatsapp.phoneNumberId),
  openrouter: Boolean(env.openrouterKey),
  sheets: Boolean(env.sheets.clientEmail && env.sheets.privateKey && env.sheets.spreadsheetId),
  database: Boolean(env.databaseUrl),
};
