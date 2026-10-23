import QtQuick
import Quickshell
import Quickshell.Io
import "click-response.js" as ClickResponse
import "avatar.js" as Avatar

Item {
    id: pet

    readonly property alias hitArea: hitArea
    readonly property bool assetReady: animation.status === Image.Ready
    readonly property int frame: animation.currentFrame
    readonly property int frameCount: animation.frameCount
    readonly property string cacheRoot: "file://" + (Quickshell.env("XDG_CACHE_HOME") || Quickshell.env("HOME") + "/.cache") + "/dsh-pet/quickshell/"
    property var systemMove: () => false
    property string animationState: "idle"
    property string avatar: Quickshell.env("DSH_PET_AVATAR") === "gpt-girl" ? "gpt-girl" : "deepseek"
    readonly property bool idleFallback: avatar === "gpt-girl" && (workState !== "idle" || moving)
    property var actions: []
    property bool oneShot: false
    readonly property bool preparing: preparation.running
    property string pendingAction: ""
    property string lastClickResponse: ""
    property string preparationMessage: ""
    property string workState: "idle"
    property string task: ""
    property bool serviceConnected: false
    property bool moving: false
    property bool pointerLeftDuringMove: false
    property int previousFrame: 0
    property int completedMoves: 0
    signal contextRequested(real cursorX, real cursorY)

    implicitWidth: 400
    implicitHeight: 225

    function preview(name, once = false) {
        if (["idle", "drag", "click", "thinking", "working", "result", "waiting", "success", "error"].indexOf(name) < 0 && !actions.some(action => action.clip === name) || moving && name !== "drag")
            return;
        previousFrame = 0;
        oneShot = avatar === "deepseek" && (once || name === "click");
        animationState = Avatar.animationFor(avatar, name);
        if (oneShot)
            animation.currentFrame = 0;
        console.log("pet animation", name);
    }

    function playAction(name) {
        if (avatar !== "deepseek" || preparing || moving || !actions.some(action => action.clip === name))
            return;
        pendingAction = name;
        preparationMessage = "Preparing animation…";
        preparation.command = ["node", Quickshell.shellDir + "/../../scripts/prepare-quickshell.mjs", name];
        preparation.running = true;
    }

    function resumeWork() {
        pendingAction = "";
        preparationMessage = "";
        preview(workState);
    }

    function selectAvatar(name) {
        if (!Avatar.validAvatar(name) || moving)
            return;
        pendingAction = "";
        preparationMessage = "";
        oneShot = false;
        avatar = name;
        preview(workState);
    }

    function playClickResponse() {
        if (avatar !== "deepseek" || preparing || moving)
            return;
        const clips = actions.filter(action => action.label.startsWith("点击回应-")).map(action => action.clip);
        const selected = ClickResponse.pickResponse(clips, lastClickResponse, Math.random());
        if (!selected) {
            preview("click");
            return;
        }
        lastClickResponse = selected;
        playAction(selected);
    }

    Process {
        id: preparation
        onExited: (exitCode, exitStatus) => {
            pet.preparationMessage = exitCode === 0 && exitStatus === 0 ? "" : "Animation preparation failed";
            if (exitCode === 0 && exitStatus === 0 && !pet.moving && pet.pendingAction !== "")
                pet.preview(pet.pendingAction, true);
        }
    }

    function setWorkState(name, detail) {
        if (["idle", "thinking", "working", "result", "waiting", "success", "error"].indexOf(name) < 0)
            return;
        workState = name;
        task = detail || "";
        if (!moving && !oneShot)
            preview(workState);
    }

    function finishMove(reason) {
        if (!moving)
            return;
        moving = false;
        completedMoves++;
        preview(workState);
        console.log("pet move ended", reason);
    }

    AnimatedImage {
        id: animation

        width: pet.avatar === "gpt-girl" ? height * 364 / 344 : pet.width
        height: pet.avatar === "gpt-girl" ? Math.max(1, Math.min(220, pet.height - 24, (pet.width - 24) * 344 / 364)) : pet.height
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        anchors.bottomMargin: pet.avatar === "gpt-girl" ? 12 - height * 8 / 344 : 0
        source: pet.avatar === "gpt-girl"
            ? "file://" + Quickshell.shellDir + "/../../assets/gpt-girl/video-resolutions-v8/idle-loop-344-v8.webp"
            : pet.cacheRoot + encodeURIComponent(pet.animationState) + ".webp"
        fillMode: Image.PreserveAspectFit
        playing: true
        cache: false
        smooth: true
        onStatusChanged: {
            if (status === Image.Error)
                console.error("Pet asset failed to load", source);
        }
        onCurrentFrameChanged: {
            if (pet.oneShot && currentFrame < pet.previousFrame && pet.previousFrame >= frameCount - 2)
                pet.preview(pet.workState);
            pet.previousFrame = currentFrame;
        }
    }

    Text {
        anchors.bottom: parent.bottom
        anchors.horizontalCenter: parent.horizontalCenter
        text: pet.preparationMessage || (pet.avatar === "gpt-girl"
            ? (!pet.serviceConnected ? "Offline" : pet.workState !== "idle" ? pet.workState + " · idle animation" : "") : "")
        visible: text !== ""
        color: "white"
        style: Text.Outline
        styleColor: "#333333"
        font.pixelSize: pet.avatar === "gpt-girl" ? 11 : 13
    }

    MouseArea {
        id: hitArea

        property point pressPosition: Qt.point(0, 0)

        x: pet.avatar === "gpt-girl" ? animation.x : pet.width * 0.3125
        y: pet.avatar === "gpt-girl" ? animation.y : pet.height * 0.125
        width: pet.avatar === "gpt-girl" ? animation.width : pet.width * 0.375
        height: pet.avatar === "gpt-girl" ? animation.height : pet.height * 0.79
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton | Qt.RightButton
        cursorShape: pet.moving ? Qt.ClosedHandCursor : Qt.OpenHandCursor

        onPressed: mouse => {
            console.log("pet pointer pressed", mouse.button);
            if (mouse.button === Qt.RightButton) {
                pet.contextRequested(x + mouse.x, y + mouse.y);
                return;
            }
            pressPosition = Qt.point(mouse.x, mouse.y);
        }
        onPositionChanged: mouse => {
            if (!(pressedButtons & Qt.LeftButton) || pet.moving)
                return;
            if (Math.hypot(mouse.x - pressPosition.x, mouse.y - pressPosition.y) < 5)
                return;
            pet.moving = true;
            pet.pointerLeftDuringMove = false;
            pet.preview("drag");
            const accepted = pet.systemMove();
            console.log("pet system move accepted", accepted);
            if (!accepted) {
                pet.moving = false;
                pet.preview(pet.workState);
            }
        }
        onReleased: mouse => {
            console.log("pet pointer released", mouse.button);
            if (mouse.button !== Qt.LeftButton)
                return;
            if (pet.moving)
                pet.finishMove("release");
            else
                pet.playClickResponse();
        }
        onCanceled: console.log("pet pointer canceled", pet.moving)
        onExited: {
            if (pet.moving)
                pet.pointerLeftDuringMove = true;
            console.log("pet pointer exited", pet.moving);
        }
        onEntered: {
            console.log("pet pointer entered", pressedButtons, pet.moving);
            if (pet.moving && pet.pointerLeftDuringMove && pressedButtons === Qt.NoButton)
                pet.finishMove("pointer re-entry without buttons");
        }
    }
}
