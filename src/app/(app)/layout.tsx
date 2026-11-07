import { Suspense, type ReactNode } from "react";
import { currentUser } from "@/lib/web/api";
import { logout } from "@/app/actions";
import { Shell } from "./Shell";

// Every page below requires a valid session: currentUser() redirects to /login otherwise.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const name = user.display_name || user.email.split("@")[0];
  return (
    <Suspense>
      <Shell user={{ name, email: user.email, role: user.role }} logout={logout}>{children}</Shell>
    </Suspense>
  );
}
