import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://127.0.0.1:8888"),
  title: "Tempo Atlas",
  description: "Your music collection, laid out by tempo.",
};

export const viewport: Viewport = { themeColor: "#0e0e10", width: "device-width", initialScale: 1 };

// Dark by default; the theme toggle stores "light" in localStorage.
const themeScript = `try{if(localStorage.theme!=="light")document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
