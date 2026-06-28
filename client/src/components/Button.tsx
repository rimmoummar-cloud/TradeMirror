import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

export function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  const cls = `btn${variant === "secondary" ? " secondary" : ""}${
    className ? ` ${className}` : ""
  }`;
  return <button className={cls} {...rest} />;
}
