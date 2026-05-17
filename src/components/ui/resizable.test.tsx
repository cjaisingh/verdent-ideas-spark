import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "./resizable";

function renderGroup(props: { withHandle?: boolean; handleClass?: string } = {}) {
  return render(
    <ResizablePanelGroup direction="horizontal" data-testid="group">
      <ResizablePanel defaultSize={50}>
        <div>left</div>
      </ResizablePanel>
      <ResizableHandle
        withHandle={props.withHandle}
        className={props.handleClass}
        data-testid="handle"
      />
      <ResizablePanel defaultSize={50}>
        <div>right</div>
      </ResizablePanel>
    </ResizablePanelGroup>,
  );
}

describe("ResizableHandle", () => {
  it("renders the handle and both panels", () => {
    renderGroup();
    expect(screen.getByTestId("group")).toBeInTheDocument();
    expect(screen.getByTestId("handle")).toBeInTheDocument();
    expect(screen.getByText("left")).toBeInTheDocument();
    expect(screen.getByText("right")).toBeInTheDocument();
  });

  it("does not render the grip when withHandle is false", () => {
    const { container } = renderGroup({ withHandle: false });
    expect(container.querySelector("svg.lucide-grip-vertical")).toBeNull();
  });

  it("renders the grip when withHandle is true", () => {
    const { container } = renderGroup({ withHandle: true });
    // GripVertical from lucide-react renders as an svg with class "lucide-grip-vertical".
    expect(container.querySelector("svg.lucide-grip-vertical")).not.toBeNull();
  });

  it("forwards className onto the handle", () => {
    renderGroup({ handleClass: "custom-handle-class" });
    expect(screen.getByTestId("handle").className).toContain("custom-handle-class");
  });

  it("has a displayName so it appears correctly in devtools", () => {
    expect(ResizableHandle.displayName).toBe("ResizableHandle");
  });
});
