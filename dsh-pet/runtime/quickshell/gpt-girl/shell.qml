import QtQuick
import Quickshell
import Quickshell.Io
import "motion.js" as Motion

ShellRoot {
    FloatingWindow {
        id: window
        title: "dsh-pet GPT girl idle pilot"
        color: "transparent"
        implicitWidth: 264
        implicitHeight: 244
        mask: Region { item: hitArea }

        property real phase: 0
        readonly property real breath: Motion.breathing(phase)
        property real breathStrength: 3.0
        property real blinkProgress: 0
        readonly property bool closedEyes: blinkProgress > 0.9
        property int textureHeight: 220
        property int completedBlinks: 0

        Item {
            id: sprite
            width: height * 1312 / 1199
            height: Math.max(1, Math.min(220, parent.height - 24, (parent.width - 24) * 1199 / 1312))
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.bottom: parent.bottom
            anchors.bottomMargin: 12

            Image {
                id: openPose
                anchors.fill: parent
                source: "file://" + Quickshell.shellDir + "/../../../assets/gpt-girl/concept-v1.png"
                sourceSize.height: window.textureHeight
                smooth: true
                visible: false
            }

            Image {
                id: halfPose
                anchors.fill: parent
                source: "file://" + Quickshell.shellDir + "/../../../assets/gpt-girl/idle-half-blink-v1.png"
                sourceSize.height: window.textureHeight
                smooth: true
                visible: false
            }

            Image {
                id: closedPose
                anchors.fill: parent
                source: "file://" + Quickshell.shellDir + "/../../../assets/gpt-girl/idle-blink-v1.png"
                sourceSize.height: window.textureHeight
                smooth: true
                visible: false
            }

            ShaderEffect {
                anchors.fill: parent
                property var openTexture: openPose
                property var halfTexture: halfPose
                property var closedTexture: closedPose
                property real breath: window.breath * window.breathStrength
                property real follow: Motion.breathing(window.phase - 0.06) * Math.sqrt(window.breathStrength)
                property real blink: halfPose.status === Image.Ready && closedPose.status === Image.Ready ? window.blinkProgress : 0
                fragmentShader: "file://" + Quickshell.shellDir + "/idle-blink-breath-v4.frag.qsb"
            }
        }

        NumberAnimation on phase {
            running: window.visible
            loops: Animation.Infinite
            from: 0
            to: 1
            duration: 4200
        }

        Timer {
            id: blinkTimer
            interval: Motion.blinkDelay(Math.random())
            running: window.visible && !blinkAnimation.running
            onTriggered: {
                blinkAnimation.start();
            }
        }

        SequentialAnimation {
            id: blinkAnimation
            NumberAnimation { target: window; property: "blinkProgress"; from: 0; to: 1; duration: 90; easing.type: Easing.InQuad }
            PauseAnimation { duration: 25 }
            NumberAnimation { target: window; property: "blinkProgress"; from: 1; to: 0; duration: 125; easing.type: Easing.OutQuad }
            onFinished: {
                window.completedBlinks++;
                blinkTimer.interval = Motion.blinkDelay(Math.random());
                blinkTimer.restart();
            }
        }

        MouseArea {
            id: hitArea
            anchors.fill: sprite
            acceptedButtons: Qt.LeftButton
            cursorShape: Qt.OpenHandCursor
            property point pressPosition: Qt.point(0, 0)
            property bool moveRequested: false
            onPressed: mouse => {
                pressPosition = Qt.point(mouse.x, mouse.y);
                moveRequested = false;
            }
            onPositionChanged: mouse => {
                if (moveRequested || !(pressedButtons & Qt.LeftButton))
                    return;
                if (Math.hypot(mouse.x - pressPosition.x, mouse.y - pressPosition.y) >= 5) {
                    moveRequested = true;
                    window.startSystemMove();
                }
            }
        }

        IpcHandler {
            target: "pilot"
            function status(): string {
                return JSON.stringify({
                    name: "GPT girl idle pilot", openReady: openPose.status === Image.Ready,
                    blinkReady: closedPose.status === Image.Ready && halfPose.status === Image.Ready,
                    closedEyes: window.closedEyes, blinkProgress: window.blinkProgress,
                    completedBlinks: window.completedBlinks, breath: window.breath,
                    textureHeight: window.textureHeight, cycleMs: 4200,
                    breathStrength: window.breathStrength,
                    torsoMotion: "vertical-only",
                    lookMode: "disabled",
                    footAnchor: sprite.y + sprite.height,
                    footOffset: window.height - sprite.y - sprite.height,
                    width: window.width, height: window.height
                });
            }
        }
    }
}
