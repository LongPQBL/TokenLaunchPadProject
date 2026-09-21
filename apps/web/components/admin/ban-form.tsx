"use client";

import { UI } from "@vezta/shared";
import { useState } from "react";
import { getModerationApi } from "@/lib/moderation/client";
import { ConfirmAction } from "./confirm-action";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Bans an address: its comments stop being shown and it cannot post. Asks first; nothing is deleted. */
export function BanForm({ chain }: { chain: string }) {
  const [value, setValue] = useState("");
  const [done, setDone] = useState(false);
  const address = value.trim();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-sm">
          {UI.admin.ban.label}
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setDone(false);
            }}
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-96 max-w-full rounded-lg border bg-background px-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
        </label>
        <ConfirmAction
          label={UI.admin.ban.button}
          title={UI.admin.ban.dialogTitle}
          body={UI.admin.ban.dialogBody}
          confirmLabel={UI.admin.ban.confirm}
          busyLabel={UI.admin.ban.confirming}
          disabled={!ADDRESS.test(address)}
          run={() => getModerationApi().banUser(chain, address)}
          onDone={() => {
            setValue("");
            setDone(true);
          }}
        />
      </div>
      {done && (
        <p role="status" className="text-sm text-muted-foreground">
          {UI.admin.ban.done}
        </p>
      )}
    </div>
  );
}
