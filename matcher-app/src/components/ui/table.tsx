import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const contentRef = React.useRef<HTMLDivElement>(null)
  const scrollbarRef = React.useRef<HTMLDivElement>(null)
  const [scrollWidth, setScrollWidth] = React.useState(0)
  const [hasOverflow, setHasOverflow] = React.useState(false)
  const syncingRef = React.useRef(false)

  const syncScroll = React.useCallback((source: "content" | "scrollbar") => {
    const content = contentRef.current
    const scrollbar = scrollbarRef.current

    if (!content || !scrollbar || syncingRef.current) {
      return
    }

    syncingRef.current = true
    if (source === "content") {
      scrollbar.scrollLeft = content.scrollLeft
    } else {
      content.scrollLeft = scrollbar.scrollLeft
    }
    syncingRef.current = false
  }, [])

  React.useLayoutEffect(() => {
    const content = contentRef.current

    if (!content) {
      return
    }

    const measure = () => {
      const nextScrollWidth = content.scrollWidth
      setScrollWidth(nextScrollWidth)
      setHasOverflow(nextScrollWidth > content.clientWidth + 1)

      if (scrollbarRef.current) {
        scrollbarRef.current.scrollLeft = content.scrollLeft
      }
    }

    measure()

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(content)
    if (content.firstElementChild) {
      resizeObserver.observe(content.firstElementChild)
    }

    return () => resizeObserver.disconnect()
  }, [])

  return (
    <div data-slot="table-container" className="table-scrollbar-shell relative w-full">
      <div
        ref={contentRef}
        className="table-scrollbar-content w-full overflow-x-auto"
        onScroll={() => syncScroll("content")}
      >
        <table
          data-slot="table"
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
      {hasOverflow ? (
        <div
          ref={scrollbarRef}
          className="table-scrollbar table-scrollbar-floating sticky bottom-0 z-20 h-4 overflow-x-auto overflow-y-hidden bg-card"
          onScroll={() => syncScroll("scrollbar")}
          aria-hidden="true"
        >
          <div className="h-px" style={{ width: scrollWidth }} />
        </div>
      ) : null}
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b hover:bg-[var(--table-hover)] has-aria-expanded:bg-[var(--table-hover)] data-[state=selected]:bg-[var(--table-selected)] data-[state=selected]:hover:bg-[var(--table-selected-hover)]",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
