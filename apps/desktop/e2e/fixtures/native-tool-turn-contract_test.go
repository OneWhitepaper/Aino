//go:build integration && nativeconsumer

package repository_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func overlayReadProtocol(t *testing.T) *ainoNativeProtocol {
	t.Helper()
	path := filepath.Join(t.TempDir(), "read.txt")
	require.NoError(t, os.WriteFile(path, []byte("overlay actual file content"), 0600))
	return &ainoNativeProtocol{rig: &ainoPlatformFixture{runID: "overlay-read-contract"},
		path: path, content: "overlay actual file content"}
}

func overlayReadRequest(t *testing.T, protocol *ainoNativeProtocol, messages []ainoNativeMessage) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"model": "fixture-tool-model", "messages": messages,
		"tools": []any{map[string]any{"type": "function", "function": map[string]any{
			"name": "read_file", "parameters": map[string]any{"type": "object",
				"properties": map[string]any{"path": map[string]string{"type": "string"}}}}}}})
	require.NoError(t, err)
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewReader(body))
	request.Header.Set("Authorization", "Bearer fixture-upstream-key")
	response := httptest.NewRecorder()
	protocol.ServeHTTP(response, request)
	return response
}

func overlayReadAssistant(t *testing.T, response *httptest.ResponseRecorder) ainoNativeMessage {
	t.Helper()
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body struct {
		Choices []struct {
			Message ainoNativeMessage `json:"message"`
		} `json:"choices"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Len(t, body.Choices, 1)
	return body.Choices[0].Message
}

func overlayFileResult(t *testing.T, protocol *ainoNativeProtocol, id string) ainoNativeMessage {
	t.Helper()
	content, err := os.ReadFile(protocol.path)
	require.NoError(t, err)
	encoded, err := json.Marshal(string(content))
	require.NoError(t, err)
	return ainoNativeMessage{Role: "tool", ToolCallID: id, Content: encoded}
}

func TestAinoOverlayReadToolTwoTurns(t *testing.T) {
	protocol := overlayReadProtocol(t)
	var history []ainoNativeMessage
	var issued []string
	for turn := 0; turn < 2; turn++ {
		history = append(history, ainoNativeMessage{Role: "user", Content: json.RawMessage(`"Read the file again"`)})
		assistant := overlayReadAssistant(t, overlayReadRequest(t, protocol, history))
		require.Len(t, assistant.ToolCalls, 1)
		id := assistant.ToolCalls[0].ID
		issued = append(issued, id)
		if turn > 0 && id == issued[0] {
			// Hermes preserves the old prompt and repairs an incoming reused call id.
			id += "_d2"
			assistant.ToolCalls[0].ID = id
		}
		history = append(history, assistant, overlayFileResult(t, protocol, id))
		final := overlayReadAssistant(t, overlayReadRequest(t, protocol, history))
		require.Contains(t, string(final.Content), "Verified "+protocol.content)
		history = append(history, final)
	}
	require.NotEqual(t, issued[0], issued[1], "each new provider tool call must have its own id")
	require.EqualValues(t, 4, protocol.rig.modelCalls.Load())
	require.EqualValues(t, 2, protocol.toolResults.Load())
}

func TestAinoOverlayReadToolRejectsInvalidPair(t *testing.T) {
	for _, failure := range []string{"id", "path", "content", "intervening-user", "stale-result"} {
		t.Run(failure, func(t *testing.T) {
			protocol := overlayReadProtocol(t)
			user := ainoNativeMessage{Role: "user", Content: json.RawMessage(`"Read the file"`)}
			assistant := overlayReadAssistant(t, overlayReadRequest(t, protocol, []ainoNativeMessage{user}))
			result := overlayFileResult(t, protocol, assistant.ToolCalls[0].ID)
			history := []ainoNativeMessage{user, assistant}
			switch failure {
			case "id":
				result.ToolCallID = "unmatched-call"
			case "path":
				history[1].ToolCalls[0].Function.Arguments = `{"path":"/not-the-fixture"}`
			case "content":
				result.Content = json.RawMessage(`"not the file content"`)
			case "intervening-user":
				history = append(history, user)
			case "stale-result":
				history = append(history, result)
				final := overlayReadAssistant(t, overlayReadRequest(t, protocol, history))
				history = append(history, final, user)
				next := overlayReadAssistant(t, overlayReadRequest(t, protocol, history))
				history = append(history, next)
			}
			before := protocol.toolResults.Load()
			response := overlayReadRequest(t, protocol, append(history, result))
			require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
			require.Equal(t, before, protocol.toolResults.Load())
		})
	}
}
