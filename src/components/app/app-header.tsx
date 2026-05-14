import Image from 'next/image';
import Link from 'next/link';
import { AppNav } from './app-nav';
import { UserMenu } from './user-menu';

type AppHeaderProps = {
  email: string;
  isAdmin: boolean;
};

export function AppHeader({ email, isAdmin }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between bg-brand-600 px-8 shadow-[0_4px_16px_rgba(15,30,60,0.12)] print:hidden">
      <Link href="/calendar" className="flex items-center" aria-label="SaleDay Events — home">
        <Image
          src="/saledayevents-logo.jpg"
          alt="SaleDay Events — Automotive Marketing"
          width={246}
          height={155}
          priority
          className="h-10 w-auto rounded"
        />
      </Link>

      <div className="flex items-center gap-4">
        <AppNav isAdmin={isAdmin} />
        <UserMenu email={email} />
      </div>
    </header>
  );
}
