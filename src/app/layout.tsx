import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Checklist de Simulados",
  description: "Sistema de Acompanhamento de Simulados Institucionais",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
