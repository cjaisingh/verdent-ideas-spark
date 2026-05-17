import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ResizableDemo = () => {
  return (
    <div className="container mx-auto space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Resizable Demo</h1>
        <p className="text-sm text-muted-foreground">
          Drag the handles to test horizontal and vertical resizing across mixed panel contents.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Horizontal — three panels</CardTitle>
        </CardHeader>
        <CardContent>
          <ResizablePanelGroup
            direction="horizontal"
            className="min-h-[300px] rounded-lg border"
          >
            <ResizablePanel defaultSize={25} minSize={10}>
              <div className="flex h-full flex-col gap-2 p-4">
                <h3 className="font-medium">Sidebar</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>Item one</li>
                  <li>Item two</li>
                  <li>Item three</li>
                </ul>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={20}>
              <div className="h-full p-4">
                <h3 className="font-medium">Editor</h3>
                <pre className="mt-2 rounded bg-muted p-3 text-xs">
{`function hello() {
  return "world";
}`}
                </pre>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={25} minSize={10}>
              <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
                Inspector
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vertical — stacked panels</CardTitle>
        </CardHeader>
        <CardContent>
          <ResizablePanelGroup
            direction="vertical"
            className="min-h-[400px] rounded-lg border"
          >
            <ResizablePanel defaultSize={60}>
              <div className="h-full p-4">
                <h3 className="font-medium">Preview</h3>
                <div className="mt-2 grid h-[calc(100%-2rem)] place-items-center rounded bg-muted text-sm text-muted-foreground">
                  Content area
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={40}>
              <div className="h-full p-4">
                <h3 className="font-medium">Console</h3>
                <pre className="mt-2 rounded bg-muted p-3 text-xs text-muted-foreground">
{`> ready
> listening on :3000`}
                </pre>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nested — horizontal with vertical split</CardTitle>
        </CardHeader>
        <CardContent>
          <ResizablePanelGroup
            direction="horizontal"
            className="min-h-[400px] rounded-lg border"
          >
            <ResizablePanel defaultSize={40}>
              <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
                Files
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={60}>
              <ResizablePanelGroup direction="vertical">
                <ResizablePanel defaultSize={70}>
                  <div className="h-full p-4">
                    <h3 className="font-medium">Editor</h3>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={30}>
                  <div className="h-full p-4 text-sm text-muted-foreground">
                    Terminal
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </ResizablePanel>
          </ResizablePanelGroup>
        </CardContent>
      </Card>
    </div>
  );
};

export default ResizableDemo;
