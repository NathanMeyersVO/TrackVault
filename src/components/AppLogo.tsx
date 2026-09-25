import logoUrl from "../assets/trackvault-logo.png";
import { APP_NAME } from "../lib/appInfo";

interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className }: AppLogoProps) {
  return (
    <img
      src={logoUrl}
      alt={APP_NAME}
      className={className ?? "h-8 w-auto object-contain"}
    />
  );
}
