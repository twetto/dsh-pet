pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Controls
import Quickshell

PopupWindow {
    id: popup

    property bool actionsOpen: false
    property var actions: []
    property bool preparing: false
    property string avatar: "deepseek"
    property string workState: "idle"
    property bool connected: false
    signal chosen(string name)
    signal resetRequested()
    signal avatarChosen(string name)
    signal chatRequested()
    color: "transparent"
    implicitWidth: actionsOpen ? 476 : 216
    implicitHeight: Math.max(actionsOpen ? 420 : 0, rootChoices.implicitHeight + 16)
    grabFocus: true

    onVisibleChanged: {
        if (!visible) {
            actionsOpen = false;
            search.text = "";
        } else {
            panel.forceActiveFocus();
        }
    }

    Rectangle {
        id: panel
        anchors.fill: parent
        color: "#f8f5f0"
        border.color: "#888899"
        radius: 8
        focus: true
        Keys.onEscapePressed: popup.visible = false

        Column {
            id: rootChoices
            x: 8
            y: 8
            spacing: 4
            Repeater {
                model: [popup.avatar !== "deepseek" ? (popup.avatar === "claude-girl" ? "Claude" : popup.avatar === "gemini-girl" ? "Gemini" : "GPT girl") + " · idle only" : "Actions  ▸", "Resume work state",
                    (popup.avatar === "deepseek" ? "✓ " : "") + "DeepSeek",
                    (popup.avatar === "gpt-girl" ? "✓ " : "") + "GPT girl",
                    (popup.avatar === "gemini-girl" ? "✓ " : "") + "Gemini cat girl",
                    (popup.avatar === "claude-girl" ? "✓ " : "") + "Claude",
                    popup.avatar === "claude-girl" ? "Chat with Claude" : popup.avatar === "gemini-girl" ? "Chat with Gemini" : "Chat with GPT girl", "Close menu"]
                delegate: Rectangle {
                    id: rootItem
                    required property string modelData
                    required property int index
                    width: popup.actionsOpen ? 144 : 200
                    height: 38
                    radius: 4
                    color: rootMouse.containsMouse ? "#dedcec" : "transparent"
                    Text { anchors.centerIn: parent; text: rootItem.modelData; color: "#222233"; font.pixelSize: 13 }
                    MouseArea {
                        id: rootMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        onEntered: { if (rootItem.index === 0 && popup.avatar === "deepseek") popup.actionsOpen = true; }
                        onClicked: {
                            if (rootItem.index === 0) {
                                if (popup.avatar !== "deepseek")
                                    return;
                                popup.actionsOpen = true;
                                search.forceActiveFocus();
                                return;
                            }
                            if (rootItem.index === 1) popup.resetRequested();
                            if (rootItem.index === 2) popup.avatarChosen("deepseek");
                            if (rootItem.index === 3) popup.avatarChosen("gpt-girl");
                            if (rootItem.index === 4) popup.avatarChosen("gemini-girl");
                            if (rootItem.index === 5) popup.avatarChosen("claude-girl");
                            if (rootItem.index === 6) popup.chatRequested();
                            popup.visible = false;
                        }
                    }
                }
            }
            Text {
                text: popup.connected ? "Service: " + popup.workState : "Service: offline"
                color: "#666"
                font.pixelSize: 12
            }
        }

        Item {
            x: 168
            y: 8
            width: 300
            height: 404
            visible: popup.actionsOpen

            Rectangle {
                width: parent.width
                height: 34
                color: "white"
                radius: 4
                border.color: "#bbb"
                TextInput {
                    id: search
                    anchors.fill: parent
                    anchors.margins: 7
                    color: "#222233"
                    clip: true
                    selectByMouse: true
                    font.pixelSize: 14
                    Keys.onEscapePressed: popup.visible = false
                    Keys.onDownPressed: { list.forceActiveFocus(); list.currentIndex = 0; }
                    Text { text: "Search actions…"; visible: !search.text && !search.activeFocus; color: "#777" }
                }
            }
            Text {
                y: 40
                text: popup.preparing ? "Preparing animation…" : list.count + " / " + popup.actions.length + " actions"
                color: "#666"
                font.pixelSize: 12
            }
            ListView {
                id: list
                y: 62
                width: parent.width
                height: parent.height - y
                clip: true
                spacing: 2
                model: popup.actions.filter(action => action.label.toLowerCase().includes(search.text.toLowerCase()))
                currentIndex: -1
                boundsBehavior: Flickable.StopAtBounds
                ScrollBar.vertical: ScrollBar {}
                Keys.onEscapePressed: popup.visible = false
                Keys.onReturnPressed: {
                    if (currentIndex >= 0 && !popup.preparing) {
                        popup.chosen(model[currentIndex].clip);
                        popup.visible = false;
                    }
                }
                delegate: Rectangle {
                    id: actionItem
                    required property var modelData
                    required property int index
                    width: list.width - 14
                    height: 34
                    radius: 4
                    opacity: popup.preparing ? 0.5 : 1
                    color: actionMouse.containsMouse || list.currentIndex === index ? "#dedcec" : "transparent"
                    Text {
                        anchors.fill: parent
                        anchors.leftMargin: 8
                        verticalAlignment: Text.AlignVCenter
                        text: actionItem.modelData.label
                        color: "#222233"
                        font.pixelSize: 14
                        elide: Text.ElideRight
                    }
                    MouseArea {
                        id: actionMouse
                        anchors.fill: parent
                        enabled: !popup.preparing
                        hoverEnabled: true
                        onClicked: { popup.chosen(actionItem.modelData.clip); popup.visible = false; }
                    }
                }
            }
        }
    }
}
