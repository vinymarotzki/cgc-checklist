"use client"

import { useState } from "react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { MenuIcon, XIcon } from "lucide-react"

export function Pattern() {
  const [open, setOpen] = useState(false)

  return (
    <Button
      size="icon"
      variant="outline"
      aria-label={open ? "Close menu" : "Open menu"}
      aria-expanded={open}
      onClick={() => setOpen((v) => !v)}
    >
      <span className="relative flex size-4 items-center justify-center">
        <MenuIcon aria-hidden="true" className={cn(
                          "absolute size-4 transition-all duration-200",
                          open
                            ? "scale-75 rotate-90 opacity-0"
                            : "scale-100 rotate-0 opacity-100"
                        )} />
        <XIcon aria-hidden="true" className={cn(
                          "absolute size-4 transition-all duration-200",
                          open
                            ? "scale-100 rotate-0 opacity-100"
                            : "scale-75 -rotate-90 opacity-0"
                        )} />
      </span>
    </Button>
  )
}