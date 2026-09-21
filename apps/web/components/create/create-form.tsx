"use client";

import { chainBySlug, formatQuote, tokenFormSchema, UI, type TokenForm } from "@vezta/shared";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { useAccount, useBalance } from "wagmi";
import { ChainGuard } from "@/components/chain-guard";
import { ConnectButton } from "@/components/connect-button";
import { FundWallet } from "@/components/fund-wallet";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { useSiwe } from "@/lib/auth/use-siwe";
import { checkImage, getUploader } from "@/lib/create/upload";
import { useCreateEstimate } from "@/lib/create/use-create-estimate";
import { getDeployment } from "@/lib/deployment";
import { friendlyError } from "@/lib/tx/errors";
import { useTrade } from "@/lib/wallet/use-trade";
import { CreateSteps, type CreateStep } from "./create-steps";
import { WindowPicker } from "./window-picker";

interface Values {
  name: string;
  ticker: string;
  description: string;
  website: string;
  twitter: string;
  telegram: string;
  antiSniperWindow: number;
}
const EMPTY: Values = { name: "", ticker: "", description: "", website: "", twitter: "", telegram: "", antiSniperWindow: 60 };

type FieldErrors = Partial<Record<"name" | "ticker" | "description" | "link" | "image", string>>;

/** What to tell a person, for whatever went wrong. The API's own messages are fixed strings and safe to show as they are. */
function explain(e: unknown): string | undefined {
  if (e instanceof ApiError) return e.message;
  const friendly = friendlyError(e);
  return friendly.silent ? undefined : friendly.message;
}

export function CreateForm({ chain }: { chain: string }) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";
  const router = useRouter();
  const trade = useTrade();
  const siwe = useSiwe();
  const { address, isConnected } = useAccount();
  // The wallet that pays for the launch (the trading wallet when one is in use).
  const payer = trade.capabilities.address ?? address;
  const balance = useBalance({ address: payer, chainId: getDeployment()?.chainId, query: { enabled: !!payer } });
  const ids = useId();

  const [values, setValues] = useState<Values>(EMPTY);
  const [image, setImage] = useState<File | undefined>();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [step, setStep] = useState<CreateStep | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const busy = useRef(false);
  const [working, setWorking] = useState(false);

  const estimate = useCreateEstimate({ name: values.name, ticker: values.ticker, antiSniperWindow: values.antiSniperWindow as 0 | 60 | 600 | 5880 });

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [key]: e.target.value }));

  /** Everything checked here is also checked by the API. This is so a person hears about a typo before anything is sent. */
  function validate(): TokenForm | undefined {
    const parsed = tokenFormSchema.safeParse(values);
    const next: FieldErrors = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        if (key === "name") next.name = UI.create.errors.name;
        else if (key === "ticker") next.ticker = UI.create.errors.ticker;
        else if (key === "description") next.description = UI.create.errors.description;
        else if (key === "website" || key === "twitter" || key === "telegram") next.link = UI.create.errors.link;
      }
    }
    if (!image) next.image = UI.create.errors.imageMissing;
    else if (!checkImage(image)) next.image = UI.create.errors.image;
    setErrors(next);
    return parsed.success && !next.image ? parsed.data : undefined;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy.current) return;
    const form = validate();
    if (!form || !image) return;

    const deployment = getDeployment();
    if (!deployment) return setFailure(UI.tx.seam.not_configured);

    busy.current = true;
    setWorking(true);
    setFailure(undefined);
    try {
      setStep("upload");
      if (!siwe.isSignedIn && !(await siwe.signIn())) {
        setStep(undefined); // declined to sign: nothing has happened, nothing to say
        return;
      }
      const metadataURI = await getUploader()(form, image);

      setStep("confirm");
      const { token } = await trade.createToken({
        name: form.name,
        ticker: form.ticker,
        metadataURI,
        quoteToken: deployment.weth,
        antiSniperWindow: form.antiSniperWindow,
      });

      setStep("done");
      // Read from the TokenCreated event by the seam, never assumed.
      // ?new=1: the indexer may not have seen it yet, and the page says so instead of "not found".
      router.push(`/${chain}/token/${token.toLowerCase()}?new=1`);
    } catch (err) {
      setStep(undefined);
      setFailure(explain(err));
    } finally {
      busy.current = false;
      setWorking(false);
    }
  }

  const field = (key: keyof Values, label: string, opts: { optional?: boolean; error?: string; textarea?: boolean } = {}) => {
    const id = `${ids}-${key}`;
    const shared = {
      id,
      value: values[key] as string,
      onChange: set(key),
      "aria-invalid": opts.error ? true : undefined,
      "aria-describedby": opts.error ? `${id}-error` : undefined,
      className: "border border-border bg-background px-3 py-2",
    };
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          {opts.optional && <span className="ml-1 font-normal text-muted-foreground">({UI.create.fields.optional})</span>}
        </label>
        {opts.textarea ? <textarea rows={3} {...shared} /> : <input autoComplete="off" {...shared} />}
        {opts.error && (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {opts.error}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">{UI.create.intro}</p>

      {field("name", UI.create.fields.name, { error: errors.name })}
      {field("ticker", UI.create.fields.ticker, { error: errors.ticker })}
      {field("description", UI.create.fields.description, { optional: true, error: errors.description, textarea: true })}

      <div className="flex flex-col gap-1">
        <label htmlFor={`${ids}-image`} className="text-sm font-medium">
          {UI.create.fields.image}
        </label>
        <input
          id={`${ids}-image`}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => setImage(e.target.files?.[0])}
          aria-invalid={errors.image ? true : undefined}
        />
        <p className="text-xs text-muted-foreground">{UI.create.fields.imageHint}</p>
        {errors.image && <p className="text-xs text-destructive">{errors.image}</p>}
      </div>

      {field("website", UI.create.fields.website, { optional: true, error: errors.link })}
      {field("twitter", UI.create.fields.twitter, { optional: true })}
      {field("telegram", UI.create.fields.telegram, { optional: true })}

      <WindowPicker value={values.antiSniperWindow} onChange={(seconds) => setValues((v) => ({ ...v, antiSniperWindow: seconds }))} />

      <dl data-testid="create-costs" className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 font-mono text-sm">
        <dt className="text-muted-foreground">{UI.create.cost.fee}</dt>
        <dd className="text-right">{estimate.createFee === undefined ? "…" : `${formatQuote(estimate.createFee, decimals, 6)} ${symbol}`}</dd>
        {estimate.networkFee !== undefined && (
          <>
            <dt className="text-muted-foreground">{UI.create.cost.gas}</dt>
            <dd className="text-right">{`≈ ${formatQuote(estimate.networkFee, decimals, 6)} ${symbol}`}</dd>
          </>
        )}
      </dl>
      <p className="text-xs text-muted-foreground">{UI.create.cost.note}</p>

      <CreateSteps current={step} />

      {isConnected && payer && <FundWallet address={payer} balance={balance.data?.value} chain={chain} />}

      <ChainGuard chainName={config?.name ?? chain}>
        {isConnected ? (
          <Button type="submit" size="lg" disabled={working}>
            {UI.create.submit}
          </Button>
        ) : (
          <ConnectButton />
        )}
      </ChainGuard>

      {!siwe.isSignedIn && isConnected && <p className="text-xs text-muted-foreground">{UI.create.signInFirst}</p>}
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      )}
    </form>
  );
}
