package com.iaperso.ui.conversations

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.iaperso.core.model.Conversation

@Composable
fun IaPersoConversationsScreen(
    conversations: List<Conversation>,
    currentConversationId: String?,
    onBack: () -> Unit,
    onNewConversation: () -> Unit,
    onOpenConversation: (Conversation) -> Unit,
    onDeleteConversation: (Conversation) -> Unit,
) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Conversations") },
                navigationIcon = {
                    Button(onClick = onBack) { Text("Retour") }
                },
                actions = {
                    Button(onClick = onNewConversation) { Text("Nouveau") }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (conversations.isEmpty()) {
                item {
                    Card(modifier = Modifier.fillMaxWidth()) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            Text("Aucune conversation", style = MaterialTheme.typography.titleMedium)
                            Text("Crée un nouveau chat pour commencer.")
                        }
                    }
                }
            }

            items(conversations, key = { it.id }) { conversation ->
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            conversation.title,
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            "${conversation.messages.size} message(s)" +
                                if (conversation.id == currentConversationId) " · ouverte" else "",
                            style = MaterialTheme.typography.bodySmall,
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { onOpenConversation(conversation) }) {
                                Text("Ouvrir")
                            }
                            Button(onClick = { onDeleteConversation(conversation) }) {
                                Text("Supprimer")
                            }
                        }
                    }
                }
            }
        }
    }
}
