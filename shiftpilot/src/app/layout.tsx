import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { integrations } from "@/lib/env";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ShiftPilot: part-timer scheduling agent",
  description: "Collects availability on WhatsApp, builds the roster, and handles sick calls with manager approval.",
};

function SetupNotice() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-xl font-medium">ShiftPilot needs a database</h1>
      <p className="mt-2 text-muted-foreground">
        Copy <code>.env.example</code> to <code>.env.local</code>, set <code>DATABASE_URL</code> to your Postgres connection string, run{" "}
        <code>npm run db:push</code>, then restart <code>npm run dev</code>.
      </p>
    </main>
  );
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-muted/30">
        <TooltipProvider>{integrations.database ? children : <SetupNotice />}</TooltipProvider>
      </body>
    </html>
  );
}
