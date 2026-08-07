package com.iaperso.ui.chat

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.weight
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.iaperso.core.model.ChatMessage
import com.iaperso.core.model.MessageRole

/**
 * First IA Perso chat surface.
 *
 * It is deliberately independent from the existing Llamatik navigation so it can be
 * integrated progressively after CI confirms the commonMain foundation compiles.
 */
@Composable
fun IaPersoChatScreen(
    state: IaPersoChatUiState,
    onSend: (String) -> Unit,
    onCancel: () -> Unit,
    onOpenModels: () -> Unit,
) {
    var draft by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("IA Perso") },
                actions = {
                    Button(onClick = onOpenModels) {
                        Text("Modèles")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (state.activeModelName == null) {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(12.dp)) {
                        Text("Aucun modèle texte chargé", style = MaterialTheme.typography.titleMedium)
                        Text("Ouvre Modèles pour choisir un fichier GGUF local.")
                    }
                }
            } else {
                Text("Modèle : ${state.activeModelName}", style = MaterialTheme.typography.labelLarge)
            }

            LazyColumn(
                modifier = Modifier.weight(1f).fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(state.messages, key = { it.id }) { message ->
                    MessageBubble(message)
                }

                if (state.isGenerating && state.streamingText.isNotBlank()) {
                    item {
                        Card(modifier = Modifier.fillMaxWidth()) {
                            Text(state.streamingText, modifier = Modifier.padding(12.dp))
                        }
                    }
                }
            }

            state.errorMessage?.let {
                Text(it, color = MaterialTheme.colorScheme.error)
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    enabled = !state.isGenerating,
                    placeholder = { Text("Écris ton message…") },
                )

                if (state.isGenerating) {
                    Button(onClick = onCancel) {
                        CircularProgressIndicator()
                        Text("Stop")
                    }
                } else {
                    Button(
                        onClick = {
                            val text = draft.trim()
                            if (text.isNotEmpty()) {
                                onSend(text)
                                draft = ""
                            }
                        },
                        enabled = state.activeModelName != null,
                    ) {
                        Text("Envoyer")
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageBubble(message: ChatMessage) {
    val roleLabel = when (message.role) {
        MessageRole.USER -> "Toi"
        MessageRole.ASSISTANT -> "IA Perso"
        MessageRole.SYSTEM -> "Système"
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(roleLabel, style = MaterialTheme.typography.labelMedium)
            Text(message.text)
        }
    }
}

data class IaPersoChatUiState(
    val messages: List<ChatMessage> = emptyList(),
    val activeModelName: String? = null,
    val isGenerating: Boolean = false,
    val streamingText: String = "",
    val errorMessage: String? = null,
)
