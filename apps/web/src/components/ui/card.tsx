import * as React from "react"
import { cn } from "@/lib/utils"

type CardProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'variant' | 'hover'> & {
  variant?: 'default' | 'glass' | 'gradient';
  hover?: boolean;
};

const Card = React.forwardRef<HTMLDivElement, CardProps>((props, ref) => {
  const { className, variant = 'default', hover = false, ...rest } = props;
  
  const variants = {
    default: "bg-card text-card-foreground border border-border",
    glass: "glass text-card-foreground",
    gradient: "bg-role-gradient text-white border-0"
  };

  // Les props hover et variant sont déjà extraits, rest ne contient que les props HTML valides
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl shadow-sm transition-all duration-300",
        variants[variant],
        hover && "hover-lift hover:shadow-md",
        className
      )}
      {...rest}
    />
  )
})
Card.displayName = "Card"

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props}
  />
))
CardHeader.displayName = "CardHeader"

type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement> & {
  gradient?: boolean;
};

const CardTitle = React.forwardRef<HTMLParagraphElement, CardTitleProps>((props, ref) => {
  const { className, gradient = false, ...rest } = props;
  
  // Filtrer explicitement le prop personnalisé gradient pour éviter qu'il soit passé au DOM
  const domProps = Object.fromEntries(
    Object.entries(rest).filter(([key]) => key !== 'gradient')
  ) as React.HTMLAttributes<HTMLHeadingElement>;

  return (
    <h3
      ref={ref}
      className={cn(
        "text-2xl font-semibold leading-none tracking-tight",
        gradient && "gradient-text",
        className
      )}
      {...domProps}
    />
  );
})
CardTitle.displayName = "CardTitle"

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CardDescription.displayName = "CardDescription"

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }










