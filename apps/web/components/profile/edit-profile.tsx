"use client";

import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, UI } from "@vezta/shared";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAccount } from "wagmi";
import { ApiError } from "@/lib/api";
import { useSiwe } from "@/lib/auth/use-siwe";
import { getProfileApi } from "@/lib/profile/client";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../ui/dialog";

/** The rule the API and the database enforce, checked here first so a bad name is caught before anything is sent. */
const USERNAME = /^[A-Za-z0-9_]{3,20}$/;
const validName = (name: string) => name === "" || (USERNAME.test(name) && !/^0x/i.test(name));

function explain(error: unknown): string {
  const e = UI.profile.edit.errors;
  if (!(error instanceof ApiError)) return e.generic;
  switch (error.code) {
    case "username_taken":
      return e.usernameTaken;
    case "bad_username":
      return e.badUsername;
    case "bad_image":
    case "too_large":
      return e.badImage;
    case "rate_limited":
      return e.rateLimited;
    case "banned":
      return e.banned;
    case "network":
      return e.network;
    default:
      return e.generic;
  }
}

/**
 * Lets someone change their own username and picture. Drawn only for the owner of the address being looked at, and only with a
 * session (the API needs one, and it is what says whose profile this is). Only what was changed is sent. Nothing is sent that
 * the API would refuse: the name is checked against the same rule, and a picture is checked for type and size first. A refusal
 * from the API is explained in words and leaves what was typed where it is.
 */
export function EditProfile({ address, current }: { address: string; current: { username?: string; avatarUrl?: string } }) {
  const { address: viewer } = useAccount();
  const { isSignedIn } = useSiwe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(current.username ?? "");
  const [file, setFile] = useState<File>();
  const [fileProblem, setFileProblem] = useState<string>();
  const [remove, setRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  // A double click must not send twice: state updates after the first click's render, a ref does not wait.
  const running = useRef(false);

  const owner = !!viewer && viewer.toLowerCase() === address.toLowerCase();
  if (!owner || !isSignedIn) return null;

  const trimmed = name.trim();
  const nameChanged = trimmed !== (current.username ?? "");
  const changed = nameChanged || !!file || remove;
  const canSave = changed && validName(trimmed) && !fileProblem && !busy;

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setName(current.username ?? "");
      setFile(undefined);
      setFileProblem(undefined);
      setRemove(false);
      setProblem(undefined);
    }
  }

  function choose(picked: File | undefined) {
    setFile(undefined);
    setFileProblem(undefined);
    if (!picked) return;
    if (!ALLOWED_IMAGE_TYPES.includes(picked.type as (typeof ALLOWED_IMAGE_TYPES)[number]))
      return setFileProblem(UI.profile.edit.errors.imageType);
    if (picked.size > MAX_IMAGE_BYTES) return setFileProblem(UI.profile.edit.errors.imageTooBig);
    setFile(picked);
    setRemove(false);
  }

  async function submit() {
    if (running.current || !canSave) return;
    running.current = true;
    setBusy(true);
    setProblem(undefined);
    try {
      await getProfileApi().update({
        ...(nameChanged ? { username: trimmed } : {}),
        ...(file ? { avatar: file } : remove ? { removeAvatar: true } : {}),
      });
      reset(false);
      router.refresh();
    } catch (e) {
      setProblem(explain(e)); // what was typed stays
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {UI.profile.edit.button}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>{UI.profile.edit.title}</DialogTitle>
        <DialogDescription>{UI.profile.edit.usernameHelp}</DialogDescription>
        <form
          className="mt-4 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {UI.profile.edit.usernameLabel}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!validName(trimmed)}
              className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive"
            />
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <label htmlFor="profile-avatar">{UI.profile.edit.avatarLabel}</label>
            <input
              id="profile-avatar"
              type="file"
              accept={ALLOWED_IMAGE_TYPES.join(",")}
              aria-describedby="profile-avatar-help"
              onChange={(e) => choose(e.target.files?.[0])}
              className="text-xs"
            />
            <span id="profile-avatar-help" className="text-xs text-muted-foreground">
              {UI.profile.edit.avatarHelp}
            </span>
          </div>
          {current.avatarUrl && !file && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} />
              {UI.profile.edit.removeAvatar}
            </label>
          )}
          {(fileProblem || problem) && (
            <p role="alert" className="text-sm text-destructive">
              {fileProblem ?? problem}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {UI.profile.edit.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSave}>
              {busy ? UI.profile.edit.saving : UI.profile.edit.save}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
