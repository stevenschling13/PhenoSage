import {
  Children,
  cloneElement,
  forwardRef,
  isValidElement,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive"
  | "surface"
  | "link";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-[rgb(var(--ps-ink))] text-[rgb(var(--ps-canvas))] hover:bg-[rgb(var(--ps-ink-2))]",
  secondary:
    "bg-[rgb(var(--ps-accent))] text-[rgb(var(--ps-accent-ink))] hover:opacity-90",
  outline:
    "border border-[rgb(var(--ps-line)/var(--ps-line-strong-strength))] bg-transparent text-[rgb(var(--ps-ink))] hover:bg-[rgb(var(--ps-ink)/0.04)]",
  ghost:
    "bg-transparent text-[rgb(var(--ps-ink))] hover:bg-[rgb(var(--ps-ink)/0.05)]",
  destructive: "bg-[rgb(var(--ps-crit))] text-white hover:opacity-90",
  surface:
    "border border-[rgb(var(--ps-line)/var(--ps-line-strong-strength))] bg-[rgb(var(--ps-surface))] text-[rgb(var(--ps-ink))] hover:bg-[rgb(var(--ps-surface-2))]",
  link: "bg-transparent text-[rgb(var(--ps-accent))] underline-offset-4 hover:underline px-0 h-auto",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3.5 text-[12.5px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-6 text-[15px] gap-2",
  icon: "h-10 w-10 p-0",
};

export const buttonStyles = (args?: Parameters<typeof buttonVariants>[0]) =>
  buttonVariants(args);

export function buttonVariants({
  variant = "primary",
  size = "md",
  fullWidth,
  className,
}: {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium tracking-[0.005em] transition-[background-color,color,transform,opacity] duration-150 ease-out-expo active:scale-[0.985]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ps-accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--ps-canvas))]",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    fullWidth && "w-full",
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
  /**
   * When true, clone the single child element and apply button styles to it
   * instead of rendering a <button>. Use this to style a <Link> as a button
   * without nesting <a> > <button> (which is invalid interactive markup).
   */
  asChild?: boolean;
}

function buttonContent({
  loading,
  leftIcon,
  rightIcon,
  children,
}: Pick<ButtonProps, "loading" | "leftIcon" | "rightIcon"> & {
  children: ReactNode;
}) {
  return (
    <>
      {loading ? (
        <span
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
          aria-hidden="true"
        />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      leftIcon,
      rightIcon,
      fullWidth,
      children,
      type = "button",
      asChild = false,
      ...rest
    },
    ref,
  ) {
    const classes = cn(
      buttonVariants({
        variant,
        size,
        ...(fullWidth !== undefined && { fullWidth }),
      }),
      className,
    );

    if (asChild) {
      const child = Children.only(children);
      if (!isValidElement(child)) {
        throw new Error("Button asChild requires a single valid React element");
      }
      const el = child as ReactElement<{
        className?: string;
        children?: ReactNode;
      }>;
      return cloneElement(
        el,
        {
          ...(rest as AnchorHTMLAttributes<HTMLAnchorElement>),
          ref,
          className: cn(classes, el.props.className),
          "aria-busy": loading || undefined,
          "aria-disabled": disabled || loading || undefined,
        } as Partial<typeof el.props>,
        buttonContent({
          loading,
          leftIcon,
          rightIcon,
          children: el.props.children,
        }),
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={classes}
        {...rest}
      >
        {buttonContent({ loading, leftIcon, rightIcon, children })}
      </button>
    );
  },
);
