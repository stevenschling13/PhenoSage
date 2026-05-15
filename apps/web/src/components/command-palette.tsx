"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  AssistantIcon,
  DashboardIcon,
  GrowIcon,
  PlantIcon,
  BellIcon,
  SettingsIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";

interface CommandPaletteProps {
  plants?: Array<{ id: string; name: string }>;
  grows?: Array<{ id: string; name: string }>;
}

export function CommandPalette({ plants = [], grows = [] }: CommandPaletteProps) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();

  // Toggle the menu with Cmd+K or Ctrl+K
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const runCommand = React.useCallback((command: () => void) => {
    setOpen(false);
    command();
  }, []);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className={cn(
        "fixed inset-0 z-50 flex items-start justify-center pt-[20vh]",
        "bg-[rgb(var(--ps-ink)/0.5)] backdrop-blur-sm",
      )}
    >
      <div
        className={cn(
          "w-full max-w-lg overflow-hidden rounded-2xl",
          "border border-[rgb(var(--ps-line)/var(--ps-line-strength))]",
          "bg-[rgb(var(--ps-surface))] shadow-2xl",
        )}
      >
        <Command.Input
          placeholder="Type a command or search..."
          className={cn(
            "w-full border-b border-[rgb(var(--ps-line)/var(--ps-line-strength))]",
            "bg-transparent px-4 py-3.5 text-[15px] text-[rgb(var(--ps-ink))]",
            "placeholder:text-[rgb(var(--ps-muted))]",
            "outline-none",
          )}
        />
        <Command.List className="max-h-[320px] overflow-y-auto p-2">
          <Command.Empty className="py-6 text-center text-sm text-[rgb(var(--ps-muted))]">
            No results found.
          </Command.Empty>

          <Command.Group
            heading="Quick actions"
            className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-[rgb(var(--ps-muted))]"
          >
            <CommandItem
              onSelect={() => runCommand(() => router.push("/grows/new"))}
            >
              <SparkIcon className="mr-3 h-4 w-4" />
              Create new grow
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/plants/new"))}
            >
              <PlantIcon className="mr-3 h-4 w-4" />
              Add new plant
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/assistant"))}
            >
              <AssistantIcon className="mr-3 h-4 w-4" />
              Open copilot
            </CommandItem>
          </Command.Group>

          <Command.Separator className="my-2 h-px bg-[rgb(var(--ps-line)/var(--ps-line-strength))]" />

          <Command.Group
            heading="Navigation"
            className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-[rgb(var(--ps-muted))]"
          >
            <CommandItem
              onSelect={() => runCommand(() => router.push("/dashboard"))}
            >
              <DashboardIcon className="mr-3 h-4 w-4" />
              Dashboard
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/grows"))}
            >
              <GrowIcon className="mr-3 h-4 w-4" />
              All grows
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/plants"))}
            >
              <PlantIcon className="mr-3 h-4 w-4" />
              All plants
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/notifications"))}
            >
              <BellIcon className="mr-3 h-4 w-4" />
              Notifications
            </CommandItem>
            <CommandItem
              onSelect={() => runCommand(() => router.push("/settings"))}
            >
              <SettingsIcon className="mr-3 h-4 w-4" />
              Settings
            </CommandItem>
          </Command.Group>

          {grows.length > 0 && (
            <>
              <Command.Separator className="my-2 h-px bg-[rgb(var(--ps-line)/var(--ps-line-strength))]" />
              <Command.Group
                heading="Grows"
                className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-[rgb(var(--ps-muted))]"
              >
                {grows.slice(0, 5).map((grow) => (
                  <CommandItem
                    key={grow.id}
                    onSelect={() =>
                      runCommand(() => router.push(`/grows/${grow.id}`))
                    }
                  >
                    <GrowIcon className="mr-3 h-4 w-4" />
                    {grow.name}
                  </CommandItem>
                ))}
              </Command.Group>
            </>
          )}

          {plants.length > 0 && (
            <>
              <Command.Separator className="my-2 h-px bg-[rgb(var(--ps-line)/var(--ps-line-strength))]" />
              <Command.Group
                heading="Plants"
                className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-[rgb(var(--ps-muted))]"
              >
                {plants.slice(0, 5).map((plant) => (
                  <CommandItem
                    key={plant.id}
                    onSelect={() =>
                      runCommand(() => router.push(`/plants/${plant.id}`))
                    }
                  >
                    <PlantIcon className="mr-3 h-4 w-4" />
                    {plant.name}
                  </CommandItem>
                ))}
              </Command.Group>
            </>
          )}
        </Command.List>

        <div className="border-t border-[rgb(var(--ps-line)/var(--ps-line-strength))] px-4 py-2.5">
          <p className="text-xs text-[rgb(var(--ps-muted))]">
            <kbd className="rounded border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface-2))] px-1.5 py-0.5 font-mono text-[10px]">
              esc
            </kbd>{" "}
            to close ·{" "}
            <kbd className="rounded border border-[rgb(var(--ps-line)/var(--ps-line-strength))] bg-[rgb(var(--ps-surface-2))] px-1.5 py-0.5 font-mono text-[10px]">
              enter
            </kbd>{" "}
            to select
          </p>
        </div>
      </div>
    </Command.Dialog>
  );
}

function CommandItem({
  children,
  onSelect,
}: {
  children: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "flex cursor-pointer items-center rounded-lg px-3 py-2.5 text-sm",
        "text-[rgb(var(--ps-ink-2))]",
        "aria-selected:bg-[rgb(var(--ps-ink)/0.06)] aria-selected:text-[rgb(var(--ps-ink))]",
        "transition-colors",
      )}
    >
      {children}
    </Command.Item>
  );
}
