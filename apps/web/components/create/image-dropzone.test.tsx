import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImageDropzone } from "./image-dropzone";

const png = (name = "logo.png", bytes = 3) => new File([new Uint8Array(bytes)], name, { type: "image/png" });
const created: string[] = [];
const revoked: string[] = [];

beforeEach(() => {
  created.length = 0;
  revoked.length = 0;
  vi.stubGlobal("URL", Object.assign(URL, {
    createObjectURL: vi.fn(() => {
      const url = `blob:preview-${created.length}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => void revoked.push(url)),
  }));
});
afterEach(() => vi.restoreAllMocks());

const show = (o: Partial<React.ComponentProps<typeof ImageDropzone>> = {}) => {
  const onChange = vi.fn();
  const view = render(
    <>
      <label htmlFor="logo">Logo</label>
      <ImageDropzone id="logo" file={undefined} onChange={onChange} {...o} />
    </>,
  );
  return { onChange, ...view };
};
const input = () => screen.getByLabelText("Logo") as HTMLInputElement;
const dropzone = () => screen.getByTestId("dropzone");
const drop = (files: File[]) => fireEvent.drop(dropzone(), { dataTransfer: { files, types: ["Files"] } });

describe("ImageDropzone: before a logo is chosen", () => {
  it("says what to do: select an image, or drag and drop it here", () => {
    show();
    expect(screen.getByText("Select an image to upload")).toBeInTheDocument();
    expect(screen.getByText("or drag and drop it here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select file" })).toBeInTheDocument();
    expect(screen.getByText("PNG, JPEG or WebP, up to 2 MB.")).toBeInTheDocument();
  });

  it("keeps a real file input, labelled Logo, that takes only the three image kinds", () => {
    show();
    expect(input()).toHaveAttribute("type", "file");
    expect(input()).toHaveAttribute("accept", "image/png,image/jpeg,image/webp");
  });

  it("opens the file dialog when Select file is pressed", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    show();
    await userEvent.setup().click(screen.getByRole("button", { name: "Select file" }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("tells which file was chosen through the dialog", async () => {
    const { onChange } = show();
    const file = png();
    await userEvent.setup().upload(input(), file);
    expect(onChange).toHaveBeenCalledWith(file);
  });

  it("takes a file dropped on it, and only the first when several are", () => {
    const { onChange } = show();
    const [a, b] = [png("a.png"), png("b.png")];
    drop([a, b]);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(a);
  });

  it("ignores a drop that carries no file: dragged text is not a logo", () => {
    const { onChange } = show();
    drop([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows that it is a place to drop while a file is over it, and stops when it leaves or lets go", () => {
    show();
    expect(dropzone()).not.toHaveAttribute("data-dragging");
    fireEvent.dragOver(dropzone(), { dataTransfer: { types: ["Files"] } });
    expect(dropzone()).toHaveAttribute("data-dragging", "true");
    fireEvent.dragLeave(dropzone());
    expect(dropzone()).not.toHaveAttribute("data-dragging");
    fireEvent.dragOver(dropzone(), { dataTransfer: { types: ["Files"] } });
    drop([png()]);
    expect(dropzone()).not.toHaveAttribute("data-dragging");
  });

  it("does not let the browser open a dropped file in the tab", () => {
    show();
    const over = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(over, "dataTransfer", { value: { types: ["Files"] } });
    dropzone().dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
  });
});

describe("ImageDropzone: once a logo is chosen", () => {
  it("shows a preview of it, its name and its size, in place of the instructions", () => {
    show({ file: png("my logo.png", 2_048) });
    expect(screen.getByRole("img", { name: "Logo preview" })).toHaveAttribute("src", "blob:preview-0");
    expect(screen.getByText("my logo.png")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(screen.queryByText("Select an image to upload")).toBeNull();
  });

  it("writes sizes the way a person reads them: bytes, kilobytes, megabytes", () => {
    const { unmount } = show({ file: png("a.png", 512) });
    expect(screen.getByText("512 B")).toBeInTheDocument();
    unmount();
    show({ file: png("b.png", 1_572_864) });
    expect(screen.getByText("1.5 MB")).toBeInTheDocument();
  });

  it("offers to replace it, which opens the file dialog again", async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    show({ file: png() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Replace" }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("offers to remove it, and tells the form there is none", async () => {
    const { onChange } = show({ file: png() });
    await userEvent.setup().click(screen.getByRole("button", { name: "Remove" }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("still takes a file dropped on it, to replace the one it has", () => {
    const { onChange } = show({ file: png("old.png") });
    const next = png("new.png");
    drop([next]);
    expect(onChange).toHaveBeenCalledWith(next);
  });

  it("lets go of the preview when the logo changes and when it is gone, so previews do not pile up", () => {
    const { rerender, unmount } = show({ file: png("a.png") });
    expect(created).toEqual(["blob:preview-0"]);
    rerender(
      <>
        <label htmlFor="logo">Logo</label>
        <ImageDropzone id="logo" file={png("b.png")} onChange={() => {}} />
      </>,
    );
    expect(revoked).toContain("blob:preview-0");
    unmount();
    expect(revoked).toContain("blob:preview-1");
  });

  it("clears the input when the logo is removed, so the same file can be chosen again", async () => {
    function Harness() {
      const [file, setFile] = useState<File | undefined>();
      return (
        <>
          <label htmlFor="logo">Logo</label>
          <ImageDropzone id="logo" file={file} onChange={setFile} />
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.upload(input(), png("same.png"));
    expect(input().files).toHaveLength(1); // the browser is holding the file
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(input().files).toHaveLength(0);
    expect(input().value).toBe("");
    // choosing the very same file again is noticed: a file input says nothing when its value has not changed
    await user.upload(input(), png("same.png"));
    expect(screen.getByText("same.png")).toBeInTheDocument();
  });
});

describe("ImageDropzone: when something is wrong", () => {
  it("says what, in words, and marks the field as invalid", () => {
    show({ error: "Choose a PNG, JPEG or WebP image of 2 MB or less." });
    expect(screen.getByText("Choose a PNG, JPEG or WebP image of 2 MB or less.")).toBeInTheDocument();
    expect(input()).toHaveAttribute("aria-invalid", "true");
    expect(dropzone()).toHaveAttribute("data-invalid", "true");
  });

  it("is not marked invalid when nothing is wrong", () => {
    show();
    expect(input()).not.toHaveAttribute("aria-invalid");
    expect(dropzone()).not.toHaveAttribute("data-invalid");
  });
});
