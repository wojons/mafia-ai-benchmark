#!/bin/bash
# Mafia AI Benchmark - Advanced Game Configuration
# 
# Usage:
#   ./mafia.sh new                    - Create new game with defaults (10 players)
#   ./mafia.sh new 8                  - Create 8-player game
#   ./mafia.sh config                 - Interactive configuration
#   ./mafia.sh config --show          - Show current config
#   ./mafia.sh config --mafia 3       - Set mafia count to 3
#   ./mafia.sh config --mafia-msg-per 4  - Mafia can send 4 messages each
#   ./mafia.sh config --town-msg-per 3   - Town can send 3 messages each
#   ./mafia.sh config --mafia-model gpt-4  - Set AI model for mafia
#   ./mafia.sh config --player1-model claude - Set model for player 1
#   ./mafia.sh list                   - List all saved games
#   ./mafia.sh continue [id]          - Continue a game
#   ./mafia.sh demo                   - Run demo game (one-off)
#   ./mafia.sh models                 - List available AI models
#   ./mafia.sh help                   - Show this help

GAME_DIR="/config/workspace/mafia"
GAME_FILE="demo-game-correct-flow-v2.js"
MANAGER_FILE="game-manager.js"
CONFIG_FILE="/config/workspace/mafia/.mafia-config"

# Default Configuration
DEFAULT_CONFIG='PLAYERS=10
MAFIA_COUNT=auto
DOCTOR_COUNT=1
SHERIFF_COUNT=1
VIGILANTE_COUNT=1
MAFIA_MESSAGES_PER_PLAYER=3
MAFIA_MAX_MESSAGES=10
TOWN_MESSAGES_PER_PLAYER=2
TOWN_MAX_MESSAGES=15
DAY_DISCUSSION_ROUNDS=1
VOTING_ENABLED=true
NIGHT_PHASE_ENABLED=true
PERSONA_ENABLED=true
AI_MODEL=openai/gpt-4o-mini
DEFAULT_MODEL=openai/gpt-4o-mini
MAFIA_MODEL=
DOCTOR_MODEL=
SHERIFF_MODEL=
VIGILANTE_MODEL=
VILLAGER_MODEL=
PLAYER1_MODEL=
PLAYER2_MODEL=
PLAYER3_MODEL=
PLAYER4_MODEL=
PLAYER5_MODEL=
PLAYER6_MODEL=
PLAYER7_MODEL=
PLAYER8_MODEL=
PLAYER9_MODEL=
PLAYER10_MODEL=
API_KEY=auto'

# Function to load config
load_config() {
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
    else
        # Create default config
        cat > "$CONFIG_FILE" << 'EOF'
PLAYERS=10
MAFIA_COUNT=auto
DOCTOR_COUNT=1
SHERIFF_COUNT=1
VIGILANTE_COUNT=1
MAFIA_MESSAGES_PER_PLAYER=3
MAFIA_MAX_MESSAGES=10
TOWN_MESSAGES_PER_PLAYER=2
TOWN_MAX_MESSAGES=15
DAY_DISCUSSION_ROUNDS=1
VOTING_ENABLED=true
NIGHT_PHASE_ENABLED=true
PERSONA_ENABLED=true
AI_MODEL=openai/gpt-4o-mini
DEFAULT_MODEL=openai/gpt-4o-mini
MAFIA_MODEL=
DOCTOR_MODEL=
SHERIFF_MODEL=
VIGILANTE_MODEL=
VILLAGER_MODEL=
PLAYER1_MODEL=
PLAYER2_MODEL=
PLAYER3_MODEL=
PLAYER4_MODEL=
PLAYER5_MODEL=
PLAYER6_MODEL=
PLAYER7_MODEL=
PLAYER8_MODEL=
PLAYER9_MODEL=
PLAYER10_MODEL=
API_KEY=auto
EOF
        source "$CONFIG_FILE"
    fi
}

# Function to save config
save_config() {
    local p_players=$1
    local p_mafia=$2
    local p_doctor=$3
    local p_sheriff=$4
    local p_vigilante=$5
    local p_mafia_msg_per=$6
    local p_mafia_msg_max=$7
    local p_town_msg_per=$8
    local p_town_msg_max=$9
    local p_day_rounds=${10}
    local p_voting=${11}
    local p_night=${12}
    local p_persona=${13}
    local p_model=${14}
    local p_default_model=${15}
    local p_mafia_model=${16}
    local p_doctor_model=${17}
    local p_sheriff_model=${18}
    local p_vigilante_model=${19}
    local p_villager_model=${20}
    local p_player1_model=${21}
    local p_player2_model=${22}
    local p_player3_model=${23}
    local p_player4_model=${24}
    local p_player5_model=${25}
    local p_player6_model=${26}
    local p_player7_model=${27}
    local p_player8_model=${28}
    local p_player9_model=${29}
    local p_player10_model=${30}
    local p_api=${31}
    
    cat > "$CONFIG_FILE" << EOF
PLAYERS=$p_players
MAFIA_COUNT=$p_mafia
DOCTOR_COUNT=$p_doctor
SHERIFF_COUNT=$p_sheriff
VIGILANTE_COUNT=$p_vigilante
MAFIA_MESSAGES_PER_PLAYER=$p_mafia_msg_per
MAFIA_MAX_MESSAGES=$p_mafia_msg_max
TOWN_MESSAGES_PER_PLAYER=$p_town_msg_per
TOWN_MAX_MESSAGES=$p_town_msg_max
DAY_DISCUSSION_ROUNDS=$p_day_rounds
VOTING_ENABLED=$p_voting
NIGHT_PHASE_ENABLED=$p_night
PERSONA_ENABLED=$p_persona
AI_MODEL=$p_model
DEFAULT_MODEL=$p_default_model
MAFIA_MODEL=$p_mafia_model
DOCTOR_MODEL=$p_doctor_model
SHERIFF_MODEL=$p_sheriff_model
VIGILANTE_MODEL=$p_vigilante_model
VILLAGER_MODEL=$p_villager_model
PLAYER1_MODEL=$p_player1_model
PLAYER2_MODEL=$p_player2_model
PLAYER3_MODEL=$p_player3_model
PLAYER4_MODEL=$p_player4_model
PLAYER5_MODEL=$p_player5_model
PLAYER6_MODEL=$p_player6_model
PLAYER7_MODEL=$p_player7_model
PLAYER8_MODEL=$p_player8_model
PLAYER9_MODEL=$p_player9_model
PLAYER10_MODEL=$p_player10_model
API_KEY=$p_api
EOF
    echo "✅ Configuration saved to $CONFIG_FILE"
}

# Function to display config
show_config() {
    load_config
    echo ""
    echo "🎛️  CURRENT MAFIA GAME CONFIGURATION"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "👥 PLAYERS:"
    echo "   Total Players:     $PLAYERS"
    echo "   Mafia Count:       ${MAFIA_COUNT:-auto (floor(n/4))}"
    echo "   Doctor Count:      $DOCTOR_COUNT"
    echo "   Sheriff Count:     $SHERIFF_COUNT"
    echo "   Vigilante Count:   $VIGILANTE_COUNT"
    echo ""
    echo "💬 MESSAGING:"
    echo "   Mafia Messages/Player:     $MAFIA_MESSAGES_PER_PLAYER"
    echo "   Mafia Max Messages Total:  $MAFIA_MAX_MESSAGES"
    echo "   Town Messages/Player:      $TOWN_MESSAGES_PER_PLAYER"
    echo "   Town Max Messages Total:   $TOWN_MAX_MESSAGES"
    echo ""
    echo "🎮 GAMEPLAY:"
    echo "   Day Discussion Rounds:  $DAY_DISCUSSION_ROUNDS"
    echo "   Voting Enabled:         $VOTING_ENABLED"
    echo "   Night Phase Enabled:    $NIGHT_PHASE_ENABLED"
    echo "   Persona System:         $PERSONA_ENABLED"
    echo ""
    echo "🤖 AI MODELS:"
    echo "   Default Model:     ${DEFAULT_MODEL:-openai/gpt-4o-mini}"
    echo "   Mafia Model:       ${MAFIA_MODEL:-[default]}"
    echo "   Doctor Model:      ${DOCTOR_MODEL:-[default]}"
    echo "   Sheriff Model:     ${SHERIFF_MODEL:-[default]}"
    echo "   Vigilante Model:   ${VIGILANTE_MODEL:-[default]}"
    echo "   Villager Model:    ${VILLAGER_MODEL:-[default]}"
    echo ""
    echo "👤 PER-PLAYER MODELS:"
    for i in {1..10}; do
        eval "model=\$PLAYER${i}_MODEL"
        if [ -n "$model" ]; then
            echo "   Player $i:  $model"
        fi
    done
    echo ""
    if [ -z "$DEFAULT_MODEL" ]; then
        echo "   ⚠️  No default model set!"
        echo "   💡 Run: ./mafia.sh config --default-model openai/gpt-4o-mini"
    fi
    echo ""
}

# Function to show interactive configuration menu
config_menu() {
    load_config
    
    echo ""
    echo "🎛️  MAFIA GAME CONFIGURATION MENU"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "Current values shown in brackets []"
    echo "Press Enter to keep current value"
    echo ""
    
    # Players
    read -p "👥 Total Players [$PLAYERS]: " input
    PLAYERS=${input:-$PLAYERS}
    
    read -p "😈 Mafia Count [${MAFIA_COUNT:-auto}]: " input
    MAFIA_COUNT=${input:-$MAFIA_COUNT}
    
    read -p "💉 Doctor Count [$DOCTOR_COUNT]: " input
    DOCTOR_COUNT=${input:-$DOCTOR_COUNT}
    
    read -p "👮 Sheriff Count [$SHERIFF_COUNT]: " input
    SHERIFF_COUNT=${input:-$SHERIFF_COUNT}
    
    read -p "🔫 Vigilante Count [$VIGILANTE_COUNT]: " input
    VIGILANTE_COUNT=${input:-$VIGILANTE_COUNT}
    
    echo ""
    echo "💬 MESSAGING SETTINGS"
    echo ""
    
    read -p "   Mafia Messages/Player [$MAFIA_MESSAGES_PER_PLAYER]: " input
    MAFIA_MESSAGES_PER_PLAYER=${input:-$MAFIA_MESSAGES_PER_PLAYER}
    
    read -p "   Mafia Max Messages Total [$MAFIA_MAX_MESSAGES]: " input
    MAFIA_MAX_MESSAGES=${input:-$MAFIA_MAX_MESSAGES}
    
    read -p "   Town Messages/Player [$TOWN_MESSAGES_PER_PLAYER]: " input
    TOWN_MESSAGES_PER_PLAYER=${input:-$TOWN_MESSAGES_PER_PLAYER}
    
    read -p "   Town Max Messages Total [$TOWN_MAX_MESSAGES]: " input
    TOWN_MAX_MESSAGES=${input:-$TOWN_MAX_MESSAGES}
    
    echo ""
    echo "🎮 GAMEPLAY SETTINGS"
    echo ""
    
    read -p "   Day Discussion Rounds [$DAY_DISCUSSION_ROUNDS]: " input
    DAY_DISCUSSION_ROUNDS=${input:-$DAY_DISCUSSION_ROUNDS}
    
    read -p "   Voting Enabled (true/false) [$VOTING_ENABLED]: " input
    VOTING_ENABLED=${input:-$VOTING_ENABLED}
    
    read -p "   Night Phase Enabled (true/false) [$NIGHT_PHASE_ENABLED]: " input
    NIGHT_PHASE_ENABLED=${input:-$NIGHT_PHASE_ENABLED}
    
    read -p "   Persona Enabled (true/false) [$PERSONA_ENABLED]: " input
    PERSONA_ENABLED=${input:-$PERSONA_ENABLED}
    
    echo ""
    echo "🤖 AI SETTINGS"
    echo ""
    
    read -p "   AI Model [$AI_MODEL]: " input
    AI_MODEL=${input:-$AI_MODEL}
    
    # Save configuration
    save_config "$PLAYERS" "$MAFIA_COUNT" "$DOCTOR_COUNT" "$SHERIFF_COUNT" "$VIGILANTE_COUNT" "$MAFIA_MESSAGES_PER_PLAYER" "$MAFIA_MAX_MESSAGES" "$TOWN_MESSAGES_PER_PLAYER" "$TOWN_MAX_MESSAGES" "$DAY_DISCUSSION_ROUNDS" "$VOTING_ENABLED" "$NIGHT_PHASE_ENABLED" "$PERSONA_ENABLED" "$AI_MODEL" "auto"
    
    echo ""
    echo "✅ Configuration saved!"
    echo ""
}

# Function to handle config command with multiple options
handle_config() {
    load_config
    
    local changed=false
    local args=("$@")
    local i=0
    
    while [ $i -lt ${#args[@]} ]; do
        local arg="${args[$i]}"
        local next="${args[$((i+1))]}"
        
        case "$arg" in
            --players|-p)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYERS=$next
                    changed=true
                    echo "✅ Players set to $PLAYERS"
                    ((i++))
                fi
                ;;
            --mafia|-M)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    MAFIA_COUNT=$next
                    changed=true
                    echo "✅ Mafia count set to $MAFIA_COUNT"
                    ((i++))
                fi
                ;;
            --mafia-msg-per)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    MAFIA_MESSAGES_PER_PLAYER=$next
                    changed=true
                    echo "✅ Mafia messages per player set to $MAFIA_MESSAGES_PER_PLAYER"
                    ((i++))
                fi
                ;;
            --mafia-msg-max)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    MAFIA_MAX_MESSAGES=$next
                    changed=true
                    echo "✅ Mafia max messages set to $MAFIA_MAX_MESSAGES"
                    ((i++))
                fi
                ;;
            --town-msg-per)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    TOWN_MESSAGES_PER_PLAYER=$next
                    changed=true
                    echo "✅ Town messages per player set to $TOWN_MESSAGES_PER_PLAYER"
                    ((i++))
                fi
                ;;
            --town-msg-max)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    TOWN_MAX_MESSAGES=$next
                    changed=true
                    echo "✅ Town max messages set to $TOWN_MAX_MESSAGES"
                    ((i++))
                fi
                ;;
            --doctor)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    DOCTOR_COUNT=$next
                    changed=true
                    echo "✅ Doctor count set to $DOCTOR_COUNT"
                    ((i++))
                fi
                ;;
            --sheriff)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    SHERIFF_COUNT=$next
                    changed=true
                    echo "✅ Sheriff count set to $SHERIFF_COUNT"
                    ((i++))
                fi
                ;;
            --vigilante)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    VIGILANTE_COUNT=$next
                    changed=true
                    echo "✅ Vigilante count set to $VIGILANTE_COUNT"
                    ((i++))
                fi
                ;;
            --day-rounds)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    DAY_DISCUSSION_ROUNDS=$next
                    changed=true
                    echo "✅ Day discussion rounds set to $DAY_DISCUSSION_ROUNDS"
                    ((i++))
                fi
                ;;
            --model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    AI_MODEL=$next
                    DEFAULT_MODEL=$next
                    changed=true
                    echo "✅ AI model set to $AI_MODEL"
                    ((i++))
                fi
                ;;
            --default-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    DEFAULT_MODEL=$next
                    AI_MODEL=$next
                    changed=true
                    echo "✅ Default model set to $DEFAULT_MODEL"
                    ((i++))
                fi
                ;;
            --mafia-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    MAFIA_MODEL=$next
                    changed=true
                    echo "✅ Mafia model set to $MAFIA_MODEL"
                    ((i++))
                fi
                ;;
            --doctor-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    DOCTOR_MODEL=$next
                    changed=true
                    echo "✅ Doctor model set to $DOCTOR_MODEL"
                    ((i++))
                fi
                ;;
            --sheriff-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    SHERIFF_MODEL=$next
                    changed=true
                    echo "✅ Sheriff model set to $SHERIFF_MODEL"
                    ((i++))
                fi
                ;;
            --vigilante-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    VIGILANTE_MODEL=$next
                    changed=true
                    echo "✅ Vigilante model set to $VIGILANTE_MODEL"
                    ((i++))
                fi
                ;;
            --villager-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    VILLAGER_MODEL=$next
                    changed=true
                    echo "✅ Villager model set to $VILLAGER_MODEL"
                    ((i++))
                fi
                ;;
            --player1-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER1_MODEL=$next
                    changed=true
                    echo "✅ Player 1 model set to $PLAYER1_MODEL"
                    ((i++))
                fi
                ;;
            --player2-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER2_MODEL=$next
                    changed=true
                    echo "✅ Player 2 model set to $PLAYER2_MODEL"
                    ((i++))
                fi
                ;;
            --player3-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER3_MODEL=$next
                    changed=true
                    echo "✅ Player 3 model set to $PLAYER3_MODEL"
                    ((i++))
                fi
                ;;
            --player4-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER4_MODEL=$next
                    changed=true
                    echo "✅ Player 4 model set to $PLAYER4_MODEL"
                    ((i++))
                fi
                ;;
            --player5-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER5_MODEL=$next
                    changed=true
                    echo "✅ Player 5 model set to $PLAYER5_MODEL"
                    ((i++))
                fi
                ;;
            --player6-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER6_MODEL=$next
                    changed=true
                    echo "✅ Player 6 model set to $PLAYER6_MODEL"
                    ((i++))
                fi
                ;;
            --player7-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER7_MODEL=$next
                    changed=true
                    echo "✅ Player 7 model set to $PLAYER7_MODEL"
                    ((i++))
                fi
                ;;
            --player8-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER8_MODEL=$next
                    changed=true
                    echo "✅ Player 8 model set to $PLAYER8_MODEL"
                    ((i++))
                fi
                ;;
            --player9-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER9_MODEL=$next
                    changed=true
                    echo "✅ Player 9 model set to $PLAYER9_MODEL"
                    ((i++))
                fi
                ;;
            --player10-model)
                if [ -n "$next" ] && [[ ! "$next" =~ ^-- ]]; then
                    PLAYER10_MODEL=$next
                    changed=true
                    echo "✅ Player 10 model set to $PLAYER10_MODEL"
                    ((i++))
                fi
                ;;
            --show|-s)
                show_config
                return
                ;;
            --menu|-m)
                config_menu
                return
                ;;
            --reset|-r)
                echo "$DEFAULT_CONFIG" > "$CONFIG_FILE"
                echo "✅ Configuration reset to defaults"
                return
                ;;
            --models)
                show_models
                return
                ;;
            *)
                # Unknown option, ignore
                ;;
        esac
        ((i++))
    done
    
    if [ "$changed" = true ]; then
        save_config "$PLAYERS" "$MAFIA_COUNT" "$DOCTOR_COUNT" "$SHERIFF_COUNT" "$VIGILANTE_COUNT" "$MAFIA_MESSAGES_PER_PLAYER" "$MAFIA_MAX_MESSAGES" "$TOWN_MESSAGES_PER_PLAYER" "$TOWN_MAX_MESSAGES" "$DAY_DISCUSSION_ROUNDS" "$VOTING_ENABLED" "$NIGHT_PHASE_ENABLED" "$PERSONA_ENABLED" "$AI_MODEL" "$DEFAULT_MODEL" "$MAFIA_MODEL" "$DOCTOR_MODEL" "$SHERIFF_MODEL" "$VIGILANTE_MODEL" "$VILLAGER_MODEL" "$PLAYER1_MODEL" "$PLAYER2_MODEL" "$PLAYER3_MODEL" "$PLAYER4_MODEL" "$PLAYER5_MODEL" "$PLAYER6_MODEL" "$PLAYER7_MODEL" "$PLAYER8_MODEL" "$PLAYER9_MODEL" "$PLAYER10_MODEL" "auto"
    fi
}

# Function to display available models
show_models() {
    echo ""
    echo "🤖 AVAILABLE AI MODELS"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "📡 OPENAI:"
    echo "   • openai/gpt-4o-mini     (Fast, Good) ⭐ DEFAULT"
    echo "   • openai/gpt-4o          (Medium, Better)"
    echo "   • openai/gpt-4           (Slow, Best)"
    echo ""
    echo "🧠 ANTHROPIC:"
    echo "   • anthropic/claude-3-haiku-20240307          (Fast, Good)"
    echo "   • anthropic/claude-3-sonnet-20240229         (Medium, Better)"
    echo "   • anthropic/claude-3-opus-20240229           (Slow, Best)"
    echo ""
    echo "🔵 GOOGLE:"
    echo "   • google/gemini-1.5-flash   (Fast, Good)"
    echo "   • google/gemini-1.5-pro     (Medium, Better)"
    echo ""
    echo "💻 OTHER PROVIDERS:"
    echo "   • groq/llama2-70b-4096"
    echo "   • deepseek/deepseek-chat"
    echo "   • meta-llama/llama-2-70b-chat"
    echo "   • mistral/mistral-large"
    echo ""
    echo "📖 USAGE EXAMPLES:"
    echo "   ./mafia.sh config --default-model openai/gpt-4"
    echo "   ./mafia.sh config --mafia-model anthropic/claude-3"
    echo "   ./mafia.sh config --player1-model openai/gpt-4o"
    echo ""
    echo "💡 TIP: Different models have different strengths!"
    echo "   • GPT-4: Excellent reasoning and strategy"
    echo "   • Claude-3: Great at deception and social deduction"
    echo "   • Gemini: Good balanced performance"
    echo ""
}

# Function to create game with current config
create_game() {
    load_config
    
    # Calculate mafia count if auto
    if [ "$MAFIA_COUNT" = "auto" ] || [ -z "$MAFIA_COUNT" ]; then
        MAFIA_COUNT=$((PLAYERS / 4))
    fi
    
    echo "🎮 Creating Mafia Game with Custom Configuration"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "👥 Players: $PLAYERS (Mafia: $MAFIA_COUNT, Doctor: $DOCTOR_COUNT, Sheriff: $SHERIFF_COUNT, Vigilante: $VIGILANTE_COUNT)"
    echo "💬 Messages: Mafia $MAFIA_MESSAGES_PER_PLAYER/player (max $MAFIA_MAX_MESSAGES), Town $TOWN_MESSAGES_PER_PLAYER/player (max $TOWN_MAX_MESSAGES)"
    echo "🎮 Day Rounds: $DAY_DISCUSSION_ROUNDS, Voting: $VOTING_ENABLED, Night: $NIGHT_PHASE_ENABLED"
    echo "🎭 Personas: $PERSONA_ENABLED"
    echo "🤖 Models:"
    echo "   Default: ${DEFAULT_MODEL:-openai/gpt-4o-mini}"
    [ -n "$MAFIA_MODEL" ] && echo "   Mafia: $MAFIA_MODEL"
    [ -n "$DOCTOR_MODEL" ] && echo "   Doctor: $DOCTOR_MODEL"
    [ -n "$SHERIFF_MODEL" ] && echo "   Sheriff: $SHERIFF_MODEL"
    [ -n "$VIGILANTE_MODEL" ] && echo "   Vigilante: $VIGILANTE_MODEL"
    [ -n "$VILLAGER_MODEL" ] && echo "   Villager: $VILLAGER_MODEL"
    echo ""
    
    # Run game manager with config
    node "$MANAGER_FILE" new "$PLAYERS" "$MAFIA_COUNT" "$DOCTOR_COUNT" "$SHERIFF_COUNT" "$VIGILANTE_COUNT" "$MAFIA_MESSAGES_PER_PLAYER" "$MAFIA_MAX_MESSAGES" "$TOWN_MESSAGES_PER_PLAYER" "$TOWN_MAX_MESSAGES" "$DAY_DISCUSSION_ROUNDS" "$VOTING_ENABLED" "$NIGHT_PHASE_ENABLED" "$PERSONA_ENABLED" "$AI_MODEL" "$DEFAULT_MODEL" "$MAFIA_MODEL" "$DOCTOR_MODEL" "$SHERIFF_MODEL" "$VIGILANTE_MODEL" "$VILLAGER_MODEL" "$PLAYER1_MODEL" "$PLAYER2_MODEL" "$PLAYER3_MODEL" "$PLAYER4_MODEL" "$PLAYER5_MODEL" "$PLAYER6_MODEL" "$PLAYER7_MODEL" "$PLAYER8_MODEL" "$PLAYER9_MODEL" "$PLAYER10_MODEL"
}

# Main command handling
case "$1" in
    new)
        if [ -z "$2" ]; then
            create_game
        elif [ "$2" = "--config" ] || [ "$2" = "-c" ]; then
            config_menu
        else
            # Legacy: ./mafia.sh new 8
            node "$MANAGER_FILE" new "$2"
        fi
        ;;
        
    config)
        shift
        if [ -z "$1" ]; then
            config_menu
        else
            handle_config "$@"
        fi
        ;;
        
    config-players|player-config)
        shift
        bash "$GAME_DIR/mafia-players.sh" "$@"
        ;;
        
    continue)
        if [ -z "$2" ]; then
            LAST_GAME=$(ls -t "$GAME_DIR/saved-games/"*.json 2>/dev/null | head -1)
            if [ -z "$LAST_GAME" ]; then
                echo "❌ No saved games found. Create one first with: ./mafia.sh new"
            else
                GAME_ID=$(basename "$LAST_GAME" .json)
                echo "🔄 Continuing most recent game: $GAME_ID"
                echo "   (Full continuation coming soon!)"
            fi
        else
            echo "🔄 Continuing game: $2"
            echo "   (Full continuation coming soon!)"
        fi
        ;;
        
    list)
        node "$MANAGER_FILE" list
        ;;
        
    demo)
        load_config
        echo "🎮 Running demo game (one-off, not saved)..."
        echo "   Model: $AI_MODEL | Personas: $PERSONA_ENABLED | Players: $PLAYERS"
        echo ""
        node "$GAME_FILE" --demo --model "$AI_MODEL" --personas "$PERSONA_ENABLED"
        ;;
        
    delete)
        if [ -z "$2" ]; then
            echo "❌ Usage: ./mafia.sh delete [gameId]"
            echo "   Run: ./mafia.sh list   to see available games"
        else
            node "$MANAGER_FILE" delete "$2"
        fi
        ;;
        
    help|*)
        echo "╔══════════════════════════════════════════════════════════════╗"
        echo "║          🎮 MAFIA AI BENCHMARK - ADVANCED MANAGER           ║"
        echo "╚══════════════════════════════════════════════════════════════╝"
        echo ""
        echo "🎯 QUICK START:"
        echo "   ./mafia.sh new              Create game with defaults"
        echo "   ./mafia.sh demo             Run one-off demo"
        echo ""
        echo "🎛️  CONFIGURATION:"
        echo "   ./mafia.sh config --show    View current settings"
        echo "   ./mafia.sh config --menu    Interactive config menu"
        echo "   ./mafia.sh config --mafia 3 Set mafia to 3 players"
        echo "   ./mafia.sh config --mafia-msg-per 4  Mafia: 4 msgs/player"
        echo "   ./mafia.sh config --town-msg-per 3   Town: 3 msgs/player"
        echo ""
        echo "🎮 GAME MANAGEMENT:"
        echo "   ./mafia.sh new              Create new game"
        echo "   ./mafia.sh list             List saved games"
        echo "   ./mafia.sh continue [id]    Resume a game"
        echo "   ./mafia.sh delete [id]      Delete a game"
        echo ""
        echo "📋 FULL OPTIONS:"
        echo ""
        echo "Players & Roles:"
        echo "  --players, -p [n]           Total players (default: 10)"
        echo "  --mafia, -M [n]             Mafia count (default: auto=floor(n/4))"
        echo "  --doctor [n]                Doctor count (default: 1)"
        echo "  --sheriff [n]               Sheriff count (default: 1)"
        echo "  --vigilante [n]             Vigilante count (default: 1)"
        echo ""
        echo "Messaging:"
        echo "  --mafia-msg-per [n]         Mafia messages per player (default: 3)"
        echo "  --mafia-msg-max [n]         Mafia max total messages (default: 10)"
        echo "  --town-msg-per [n]          Town messages per player (default: 2)"
        echo "  --town-msg-max [n]          Town max total messages (default: 15)"
        echo ""
        echo "Gameplay:"
        echo "  --day-rounds [n]            Day discussion rounds (default: 1)"
        echo "  --model [name]              AI model (default: openai/gpt-4o-mini)"
        echo ""
        echo "Config Management:"
        echo "  --show, -s                  Display current configuration"
        echo "  --menu, -m                  Interactive configuration menu"
        echo "  --reset, -r                 Reset to default settings"
        echo ""
        echo "📖 EXAMPLES:"
        echo "   ./mafia.sh config --mafia 3 --mafia-msg-per 4"
        echo "   ./mafia.sh config --town-msg-per 3 --day-rounds 2"
        echo "   ./mafia.sh config --model anthropic/claude-3"
        echo "   ./mafia.sh new"
        echo ""
        ;;
esac
