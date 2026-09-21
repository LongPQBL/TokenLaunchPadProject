import { UI } from "@vezta/shared";

export type CreateStep = "upload" | "confirm" | "done";
const ORDER: CreateStep[] = ["upload", "confirm", "done"];
const LABELS: Record<CreateStep, string> = { upload: UI.create.steps.upload, confirm: UI.create.steps.confirm, done: UI.create.steps.live };

/**
 * The three things creating a token involves. `current` is the one in progress; earlier ones are done, later ones wait.
 * "done" means the last step is reached too, so all three show as finished. Before anything starts, all three wait.
 */
export function CreateSteps({ current }: { current: CreateStep | undefined }) {
  const at = current === undefined ? -1 : ORDER.indexOf(current);
  return (
    <ol aria-label={UI.create.steps.label} className="flex flex-col gap-2 sm:flex-row sm:gap-6">
      {ORDER.map((step, i) => {
        const state = current === "done" || i < at ? "done" : i === at ? "current" : "waiting";
        return (
          <li
            key={step}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className={state === "waiting" ? "text-muted-foreground" : state === "current" ? "font-semibold text-primary" : "text-buy"}
          >
            {LABELS[step]}
          </li>
        );
      })}
    </ol>
  );
}
