import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import { Skeleton } from "./skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

// The primitives are copied from vezta-fe. These check the copies wire up: the imports resolve, Radix mounts, and the
// pieces render the content given to them.
describe("copied primitives", () => {
  it("renders a card with its parts", () => {
    render(
      <Card>
        <CardHeader><CardTitle>Token</CardTitle></CardHeader>
        <CardContent>body</CardContent>
      </Card>,
    );
    expect(screen.getByText("Token")).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders a badge", () => {
    render(<Badge>TRADING</Badge>);
    expect(screen.getByText("TRADING")).toBeInTheDocument();
  });

  it("renders a skeleton placeholder", () => {
    const { container } = render(<Skeleton className="h-4 w-20" />);
    expect(container.firstElementChild).toHaveClass("h-4", "w-20");
  });

  it("renders a table", () => {
    render(
      <Table>
        <TableHeader><TableRow><TableHead>Trader</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableCell>0xabc</TableCell></TableRow></TableBody>
      </Table>,
    );
    expect(screen.getByRole("columnheader", { name: "Trader" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "0xabc" })).toBeInTheDocument();
  });

  it("shows the active tab's content and its trigger", () => {
    render(
      <Tabs defaultValue="trades">
        <TabsList>
          <TabsTrigger value="trades">Trades</TabsTrigger>
          <TabsTrigger value="holders">Holders</TabsTrigger>
        </TabsList>
        <TabsContent value="trades">trade rows</TabsContent>
        <TabsContent value="holders">holder rows</TabsContent>
      </Tabs>,
    );
    expect(screen.getByRole("tab", { name: "Trades" })).toHaveAttribute("data-state", "active");
    expect(screen.getByText("trade rows")).toBeInTheDocument();
    expect(screen.queryByText("holder rows")).not.toBeInTheDocument();
  });
});
