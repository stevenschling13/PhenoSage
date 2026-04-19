import type { SVGProps } from "react";
import { cn } from "@/lib/cn";

type IconProps = SVGProps<SVGSVGElement> & {
  title?: string;
};

function IconBase({
  children,
  className,
  title,
  viewBox = "0 0 24 24",
  ...props
}: IconProps) {
  return (
    <svg
      aria-hidden={title ? undefined : true}
      className={cn("h-5 w-5 shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.8}
      viewBox={viewBox}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export function LogoMark({ className, ...props }: IconProps) {
  return (
    <IconBase className={cn("h-7 w-7", className)} {...props}>
      <path d="M6.5 14.2c0-5.2 2.3-8.7 5.5-10.7 3.3 2 5.5 5.5 5.5 10.7 0 3.1-2.5 5.8-5.5 5.8S6.5 17.3 6.5 14.2Z" />
      <path d="M12 4.4v14.5" />
      <path d="M8.6 10.6c1.7 0 2.7 1 3.4 2.4" />
      <path d="M15.4 10.6c-1.7 0-2.7 1-3.4 2.4" />
    </IconBase>
  );
}

export function ArrowUpRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </IconBase>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 6 6 6-6 6" />
    </IconBase>
  );
}

export function DashboardIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="4" rx="1.5" />
      <rect x="13.5" y="10.5" width="7" height="10" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    </IconBase>
  );
}

export function GrowIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 20.5V8" />
      <path d="M12 12.2c-1.9-3.1-4.7-4.7-8-4.7.2 3.7 2.8 6.5 6.7 6.7" />
      <path d="M12 14.2c1.9-3.1 4.7-4.7 8-4.7-.2 3.7-2.8 6.5-6.7 6.7" />
    </IconBase>
  );
}

export function PlantIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 20V9.2" />
      <path d="M12 12.5c-1.4-2.7-3.8-4-6.8-4 0 3.3 2.1 5.8 5.7 6.4" />
      <path d="M12 15c1.4-2.7 3.8-4 6.8-4 0 3.3-2.1 5.8-5.7 6.4" />
      <path d="M8 20h8" />
    </IconBase>
  );
}

export function AssistantIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 9.5h8" />
      <path d="M8 13.5h5" />
      <path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h10a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 16H11l-4 4v-4H7A2.5 2.5 0 0 1 4.5 13.5Z" />
    </IconBase>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.1" />
      <path d="M12 18.4v2.1" />
      <path d="m5.9 5.9 1.5 1.5" />
      <path d="m16.6 16.6 1.5 1.5" />
      <path d="M3.5 12h2.1" />
      <path d="M18.4 12h2.1" />
      <path d="m5.9 18.1 1.5-1.5" />
      <path d="m16.6 7.4 1.5-1.5" />
    </IconBase>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 16V6.5" />
      <path d="m8.5 10 3.5-3.5 3.5 3.5" />
      <path d="M4.5 18.5h15" />
    </IconBase>
  );
}

export function TimelineIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 6.5h12" />
      <path d="M6 12h12" />
      <path d="M6 17.5h12" />
      <circle cx="8" cy="6.5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="16" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="17.5" r="1.25" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 8v4.2" />
      <path d="M12 16h.01" />
      <path d="M10.2 4.8 3.9 16a2 2 0 0 0 1.7 3h12.8a2 2 0 0 0 1.7-3L13.8 4.8a2 2 0 0 0-3.5 0Z" />
    </IconBase>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3.8 13.6 9l5.2 1.6-5.2 1.6L12 17.4l-1.6-5.2-5.2-1.6L10.4 9Z" />
      <path d="m18.4 3.6.7 2.2 2.2.7-2.2.7-.7 2.2-.7-2.2-2.2-.7 2.2-.7Z" />
    </IconBase>
  );
}

export function AnalysisIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.5 7.5A3.5 3.5 0 0 1 8 4h8a3.5 3.5 0 0 1 3.5 3.5v9A3.5 3.5 0 0 1 16 20H8a3.5 3.5 0 0 1-3.5-3.5Z" />
      <path d="m8.5 14 2.4-2.4 1.9 1.9 3.7-3.7" />
    </IconBase>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 12h4l1.9-4 3.2 8 2.4-5h5.5" />
    </IconBase>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.9 12.3 2.1 2.1 4.3-4.6" />
    </IconBase>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4c2 .9 4.2 1.4 6.5 1.6v5.4c0 4-2.5 7.1-6.5 9-4-1.9-6.5-5-6.5-9V5.6C7.8 5.4 10 4.9 12 4Z" />
      <path d="m9.4 12 1.7 1.7 3.5-3.7" />
    </IconBase>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7.5 16.5h9" />
      <path d="M9.2 18a2.8 2.8 0 0 0 5.6 0" />
      <path d="M18 16.5c-.9-.9-1.4-2.1-1.4-3.5V11a4.6 4.6 0 1 0-9.2 0v2c0 1.4-.5 2.6-1.4 3.5" />
    </IconBase>
  );
}
