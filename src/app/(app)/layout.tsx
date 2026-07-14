import { AppShell } from '@/components/app-shell';
import { brand } from '@/lib/config';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell brand={brand}>{children}</AppShell>;
}
