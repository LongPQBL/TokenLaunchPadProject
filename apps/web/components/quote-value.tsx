"use client";

import { chainBySlug, formatQuote, formatSignedUsdValue, formatTokenPrice, formatUsdPrice, formatUsdValue, type UsdRate } from "@vezta/shared";
import { useHasChain } from "@/lib/chain/use-has-chain";
import { formatSignedQuote } from "@/lib/format";
import { useUsdRate } from "@/lib/chain/use-usd-rate";
import { cn } from "@/lib/utils";

interface QuoteProps {
  chain: string;
  raw: bigint;
  compact?: boolean;
  signed?: boolean;
  secondary?: boolean;
  /** How many decimals the amount in ETH is cut to, for the tooltip and for when there is no price. Default 4. */
  digits?: number;
  className?: string;
}

function quoteText({ chain, raw, signed, digits = 4 }: QuoteProps) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";
  return { decimals, text: `${signed ? formatSignedQuote(raw, decimals, digits) : formatQuote(raw, decimals, digits)} ${symbol}` };
}

function QuoteView(props: QuoteProps & { rate: UsdRate | undefined }) {
  const { raw, compact = false, signed = false, secondary = false, className, rate } = props;
  const { decimals, text } = quoteText(props);
  if (!rate) return <span className={className}>{text}</span>;
  const dollars = signed ? formatSignedUsdValue(raw, rate, decimals, { compact }) : formatUsdValue(raw, rate, decimals, { compact });
  return (
    <span title={text} className={cn(secondary && "inline-flex flex-col", className)}>
      <span>{dollars}</span>
      {secondary && <span className="text-xs font-normal text-muted-foreground">{text}</span>}
    </span>
  );
}

function PricedQuote(props: QuoteProps) {
  return <QuoteView {...props} rate={useUsdRate(props.chain)} />;
}

/**
 * An amount of the quote, in dollars when the chain's price feed says what a dollar is, and in ETH until then (and always when there is
 * no feed): a figure is never drawn in dollars unless there is a price to stand behind it. The ETH it comes to is in the tooltip, and
 * underneath when `secondary` is set. `signed` is for a gain or loss: "+$30.00", "-0.01 ETH". `compact` writes big amounts as $12.3K.
 */
export function QuoteValue(props: QuoteProps) {
  return useHasChain() ? <PricedQuote {...props} /> : <QuoteView {...props} rate={undefined} />;
}

interface PriceProps {
  chain: string;
  raw: bigint;
  secondary?: boolean;
  className?: string;
}

function PriceView({ chain, raw, secondary = false, className, rate }: PriceProps & { rate: UsdRate | undefined }) {
  const config = chainBySlug(chain);
  const decimals = config?.quoteDecimals ?? 18;
  const symbol = config?.quoteSymbol ?? "ETH";
  const text = `${formatTokenPrice(raw, decimals)} ${symbol}`;
  if (!rate) return <span className={className}>{text}</span>;
  return (
    <span title={text} className={cn(secondary && "inline-flex flex-col", className)}>
      <span>{formatUsdPrice(raw, rate, decimals)}</span>
      {secondary && <span className="text-xs font-normal text-muted-foreground">{text}</span>}
    </span>
  );
}

function PricedPrice(props: PriceProps) {
  return <PriceView {...props} rate={useUsdRate(props.chain)} />;
}

/**
 * A token's price (quote per whole token), in dollars when there is a price for ETH and in the quote otherwise, written out in full:
 * it is a fraction of a cent, and an exponent is hard to read.
 */
export function PriceValue(props: PriceProps) {
  return useHasChain() ? <PricedPrice {...props} /> : <PriceView {...props} rate={undefined} />;
}
