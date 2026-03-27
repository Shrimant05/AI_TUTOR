import "./globals.css";
import AnimatedLayout from "../components/AnimatedLayout";

export const metadata = {
  title: "ContextAI — Course-Aware Tutor",
  description: "A course-aware AI tutor with Socratic guidance",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AnimatedLayout>{children}</AnimatedLayout>
      </body>
    </html>
  );
}