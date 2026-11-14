import { render, screen } from "@testing-library/react";

import type { WindowState } from "../state/appState";

import { Taskbar } from "./Taskbar";

it("gives each window a button but a message box none, as Windows 98 does", () => {
  const windows: WindowState[] = [
    {
      kind: "controlpanel",
      applet: "home",
      id: "w1",
      minimized: false,
      maximized: false,
    },
    {
      kind: "dialog",
      id: "w2",
      title: "Cannot open file",
      message: "m",
      icon: "warning",
      minimized: false,
      maximized: false,
    },
  ];
  render(
    <Taskbar
      windows={windows}
      activeId="w2"
      startMenuOpen={false}
      onStart={() => undefined}
      onWindowButton={() => undefined}
    />,
  );
  expect(
    screen.getByRole("button", { name: "Control Panel" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Cannot open file/ })).toBeNull();
});
