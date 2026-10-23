import QtQuick
import Quickshell
import Quickshell.Io

ShellRoot {
    Process {
        id: chatLauncher
        command: ["node", Quickshell.shellDir + "/../../scripts/start-companion.mjs"]
    }
    Process {
        command: ["node", Quickshell.shellDir + "/service.mjs"]
        running: true
        stdout: SplitParser {
            onRead: data => {
                try {
                    const state = JSON.parse(data);
                    if (state.actions) {
                        pet.actions = state.actions;
                        return;
                    }
                    pet.serviceConnected = state.connected;
                    pet.setWorkState(state.state, state.task);
                } catch (error) {
                    console.error("pet service message", error);
                }
            }
        }
    }

    FloatingWindow {
        id: petWindow
        title: "dsh-pet — " + pet.avatar + " — " + (pet.serviceConnected ? pet.workState : "offline")
        color: "transparent"
        implicitWidth: pet.avatar === "gpt-girl" ? 256 : 400
        implicitHeight: pet.avatar === "gpt-girl" ? 244 : 225
        mask: Region { item: pet.hitArea }

        PetContent {
            id: pet
            anchors.fill: parent
            systemMove: () => petWindow.startSystemMove()
            onAvatarChanged: {
                petWindow.width = avatar === "gpt-girl" ? 256 : 400;
                petWindow.height = avatar === "gpt-girl" ? 244 : 225;
            }
            onContextRequested: (cursorX, cursorY) => {
                menu.anchor.rect.x = cursorX;
                menu.anchor.rect.y = cursorY;
                menu.visible = true;
            }
        }

        PetMenu {
            id: menu
            anchor.window: petWindow
            actions: pet.avatar === "deepseek" ? pet.actions : []
            avatar: pet.avatar
            workState: pet.workState
            connected: pet.serviceConnected
            preparing: pet.preparing
            onChosen: name => pet.playAction(name)
            onResetRequested: pet.resumeWork()
            onAvatarChosen: name => pet.selectAvatar(name)
            onChatRequested: { if (!chatLauncher.running) chatLauncher.running = true; }
        }

        IpcHandler {
            target: "pet"
            function status(): string {
                return JSON.stringify({ animation: pet.animationState, moving: pet.moving,
                    pointerLeft: pet.pointerLeftDuringMove, buttons: pet.hitArea.pressedButtons,
                    hovered: pet.hitArea.containsMouse, completedMoves: pet.completedMoves, menu: menu.visible,
                    connected: pet.serviceConnected, workState: pet.workState, task: pet.task,
                    actions: pet.avatar === "deepseek" ? pet.actions.length : 0,
                    avatar: pet.avatar, idleFallback: pet.idleFallback,
                    assetReady: pet.assetReady, frame: pet.frame, frameCount: pet.frameCount,
                    preparing: pet.preparing, oneShot: pet.oneShot });
            }
            function preview(name: string): void { pet.preview(name); }
            function action(name: string): void { pet.playAction(name); }
            function click(): void { pet.playClickResponse(); }
            function avatar(name: string): void { pet.selectAvatar(name); }
        }
    }
}
