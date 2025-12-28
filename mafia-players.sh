#!/bin/bash
# Mafia AI Benchmark - Flexible Player Model Configuration
# 
# Usage:
#   ./mafia.sh config --default-model gpt-4        Set default model
#   ./mafia.sh config --mafia-model claude-3       Set model for all mafia
#   ./mafia.sh config --player-model 1 gpt-4       Set model for player 1
#   ./mafia.sh config --range-model 1 50 gpt-4     Set model for players 1-50
#   ./mafia.sh config --pattern-model even gpt-4   Set model for even players
#   ./mafia.sh config --preset gpt4VsClaude        Use preset configuration
#   ./mafia.sh config --load template.json         Load configuration from file
#   ./mafia.sh config --save my-config.json        Save configuration to file
#   ./mafia.sh config --players 100                Support 100+ players

GAME_DIR="/config/workspace/mafia"
CONFIG_FILE="/config/workspace/mafia/.mafia-player-config"
MANAGER_FILE="game-manager.js"

# Default player configuration
DEFAULT_PLAYER_CONFIG='
{
  "version": "1.0",
  "default": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.7,
    "maxTokens": 500
  },
  "roleAssignments": {},
  "playerAssignments": {},
  "bulkAssignments": [],
  "presets": [],
  "totalPlayers": 10
}
'

# Function to load config
load_player_config() {
    if [ -f "$CONFIG_FILE" ]; then
        cat "$CONFIG_FILE"
    else
        echo "$DEFAULT_PLAYER_CONFIG" > "$CONFIG_FILE"
        cat "$CONFIG_FILE"
    fi
}

# Function to save config
save_player_config() {
    echo "$1" > "$CONFIG_FILE"
    echo "✅ Player configuration saved to $CONFIG_FILE"
}

# Function to display player configuration
show_player_config() {
    local config=$(load_player_config)
    
    echo ""
    echo "🎛️  PLAYER MODEL CONFIGURATION"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Default model
    local default_model=$(echo "$config" | grep -o '"model"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"\([^"]*\)"/\1/')
    local default_provider=$(echo "$config" | grep -o '"provider"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"\([^"]*\)"/\1/')
    echo "🤖 DEFAULT MODEL:"
    echo "   Provider: $default_provider"
    echo "   Model:    $default_model"
    echo ""
    
    # Role assignments
    echo "👥 ROLE ASSIGNMENTS:"
    local role_count=$(echo "$config" | grep -c "roleAssignments")
    if [ "$role_count" -gt 0 ]; then
        echo "$config" | grep -A 1 "roleAssignments" | grep -v "roleAssignments" | grep -v "^{" | grep -v "^}" | grep -v "^[[:space:]]*$" | while read line; do
            if [ -n "$line" ]; then
                echo "   $line"
            fi
        done
        if [ $(echo "$config" | grep -c '"MAFIA"') -gt 0 ]; then
            local mafia_model=$(echo "$config" | grep -o '"MAFIA"[[:space:]]*:[[:space:]]*{[^}]*}' | grep -o '"model"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)"/\1/')
            echo "   Mafia: $mafia_model"
        fi
        if [ $(echo "$config" | grep -c '"DOCTOR"') -gt 0 ]; then
            local doctor_model=$(echo "$config" | grep -o '"DOCTOR"[[:space:]]*:[[:space:]]*{[^}]*}' | grep -o '"model"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)"/\1/')
            echo "   Doctor: $doctor_model"
        fi
    else
        echo "   (No role assignments - using default)"
    fi
    echo ""
    
    # Player assignments
    echo "👤 SPECIFIC PLAYER ASSIGNMENTS:"
    local player_count=$(echo "$config" | grep -c "playerAssignments")
    if [ "$player_count" -gt 0 ]; then
        echo "$config" | grep -o '"[0-9]*"[[:space:]]*:[[:space:]]*{[^}]*}' | head -10 | while read assignment; do
            local index=$(echo "$assignment" | grep -o '"[0-9]*"' | head -1)
            local model=$(echo "$assignment" | grep -o '"model"[[:space:]]*:[[:space:]]*"[^"]*"' | sed 's/.*: *"\([^"]*\)"/\1/')
            if [ -n "$index" ] && [ -n "$model" ]; then
                echo "   Player ${index//\"/}: $model"
            fi
        done
    else
        echo "   (No specific player assignments)"
    fi
    echo ""
    
    # Total players
    local total=$(echo "$config" | grep -o '"totalPlayers"[[:space:]]*:[[:space:]]*[0-9]*' | sed 's/.*: *//')
    echo "📊 TOTAL PLAYERS: ${total:-10}"
    echo ""
    
    # Quick actions
    echo "💡 QUICK ACTIONS:"
    echo "   ./mafia.sh config --preset gpt4VsClaude   GPT-4 vs Claude-3"
    echo "   ./mafia.sh config --preset varying        Varying strength by role"
    echo "   ./mafia.sh config --preset experimental   All different models"
    echo "   ./mafia.sh config --reset-players         Reset player config"
    echo ""
}

# Function to update config with jq-like operations (using sed for simplicity)
update_config() {
    local key=$1
    local value=$2
    local config=$(load_player_config)
    
    # Simple update for default model
    if [ "$key" = "default_model" ]; then
        config=$(echo "$config" | sed "s/\"model\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"model\": \"$value\"/")
    elif [ "$key" = "default_provider" ]; then
        config=$(echo "$config" | sed "s/\"provider\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"provider\": \"$value\"/")
    fi
    
    save_player_config "$config"
}

# Function to set role model
set_role_model() {
    local role=$1
    local provider_model=$2
    
    local provider=$(echo "$provider_model" | cut -d'/' -f1)
    local model=$(echo "$provider_model" | cut -d'/' -f2-)
    
    local config=$(load_player_config)
    
    # Add or update role assignment
    if echo "$config" | grep -q "\"$role\""; then
        # Update existing
        config=$(echo "$config" | sed "s/\"$role\"[[:space:]]*:[[:space:]]*{[^}]*}/\"$role\": { \"provider\": \"$provider\", \"model\": \"$model\" }/")
    else
        # Add new
        config=$(echo "$config" | sed "s/\"roleAssignments\": {/\"roleAssignments\": {\"$role\": { \"provider\": \"$provider\", \"model\": \"$model\" },/")
    fi
    
    save_player_config "$config"
    echo "✅ $role model set to $provider_model"
}

# Function to set player model
set_player_model() {
    local index=$1
    local provider_model=$2
    
    local provider=$(echo "$provider_model" | cut -d'/' -f1)
    local model=$(echo "$provider_model" | cut -d'/' -f2-)
    
    local config=$(load_player_config)
    
    # Add or update player assignment
    if echo "$config" | grep -q "\"$index\""; then
        # Update existing
        config=$(echo "$config" | sed "s/\"$index\"[[:space:]]*:[[:space:]]*{[^}]*}/\"$index\": { \"provider\": \"$provider\", \"model\": \"$model\" }/")
    else
        # Add new
        config=$(echo "$config" | sed "s/\"playerAssignments\": {/\"playerAssignments\": {\"$index\": { \"provider\": \"$provider\", \"model\": \"$model\" },/")
    fi
    
    save_player_config "$config"
    echo "✅ Player $index model set to $provider_model"
}

# Function to set range of players
set_range_model() {
    local start=$1
    local end=$2
    local provider_model=$3
    
    echo "Setting models for players $start to $end to $provider_model..."
    
    for i in $(seq $start $end); do
        set_player_model $i $provider_model
    done
}

# Function to apply preset
apply_preset() {
    local preset=$1
    
    case "$preset" in
        gpt4VsClaude)
            set_role_model "MAFIA" "openai/gpt-4"
            set_role_model "DOCTOR" "anthropic/claude-3-sonnet-20240229"
            set_role_model "SHERIFF" "anthropic/claude-3-sonnet-20240229"
            set_role_model "VIGILANTE" "anthropic/claude-3-sonnet-20240229"
            set_role_model "VILLAGER" "anthropic/claude-3-sonnet-20240229"
            echo "✅ Applied preset: GPT-4 for Mafia, Claude-3 Sonnet for Town"
            ;;
        varying)
            set_role_model "MAFIA" "anthropic/claude-3-opus-20240229"
            set_role_model "SHERIFF" "openai/gpt-4"
            set_role_model "DOCTOR" "anthropic/claude-3-sonnet-20240229"
            set_role_model "VIGILANTE" "openai/gpt-4o"
            set_role_model "VILLAGER" "openai/gpt-4o-mini"
            echo "✅ Applied preset: Varying strength by role"
            ;;
        experimental)
            local models=("openai/gpt-4o-mini" "anthropic/claude-3-haiku-20240307" "google/gemini-1.5-flash")
            for i in {1..10}; do
                model_idx=$(( (i-1) % 3 ))
                set_player_model $i "${models[$model_idx]}"
            done
            echo "✅ Applied preset: Experimental (rotating models)"
            ;;
        allGpt4)
            set_role_model "MAFIA" "openai/gpt-4"
            set_role_model "DOCTOR" "openai/gpt-4"
            set_role_model "SHERIFF" "openai/gpt-4"
            set_role_model "VIGILANTE" "openai/gpt-4"
            set_role_model "VILLAGER" "openai/gpt-4"
            echo "✅ Applied preset: All GPT-4"
            ;;
        allClaude)
            set_role_model "MAFIA" "anthropic/claude-3-opus-20240229"
            set_role_model "DOCTOR" "anthropic/claude-3-opus-20240229"
            set_role_model "SHERIFF" "anthropic/claude-3-opus-20240229"
            set_role_model "VIGILANTE" "anthropic/claude-3-opus-20240229"
            set_role_model "VILLAGER" "anthropic/claude-3-opus-20240229"
            echo "✅ Applied preset: All Claude-3 Opus"
            ;;
        *)
            echo "❌ Unknown preset: $preset"
            echo "   Available presets:"
            echo "   • gpt4VsClaude  - GPT-4 for Mafia, Claude-3 for Town"
            echo "   • varying       - Different strength for different roles"
            echo "   • experimental  - Rotate through different models"
            echo "   • allGpt4       - All players use GPT-4"
            echo "   • allClaude     - All players use Claude-3 Opus"
            ;;
    esac
}

# Function to reset player configuration
reset_player_config() {
    echo "$DEFAULT_PLAYER_CONFIG" > "$CONFIG_FILE"
    echo "✅ Player configuration reset to defaults"
}

# Main command handling
case "$1" in
    config-players|player-config)
        shift
        if [ -z "$1" ]; then
            show_player_config
        else
            case "$1" in
                --show|-s)
                    show_player_config
                    ;;
                --reset)
                    reset_player_config
                    ;;
                --default-model)
                    if [ -n "$2" ]; then
                        update_config "default_model" "$2"
                        echo "✅ Default model set to $2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --default-model [model]"
                    fi
                    ;;
                --mafia-model)
                    if [ -n "$2" ]; then
                        set_role_model "MAFIA" "$2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --mafia-model [provider/model]"
                    fi
                    ;;
                --doctor-model)
                    if [ -n "$2" ]; then
                        set_role_model "DOCTOR" "$2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --doctor-model [provider/model]"
                    fi
                    ;;
                --sheriff-model)
                    if [ -n "$2" ]; then
                        set_role_model "SHERIFF" "$2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --sheriff-model [provider/model]"
                    fi
                    ;;
                --vigilante-model)
                    if [ -n "$2" ]; then
                        set_role_model "VIGILANTE" "$2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --vigilante-model [provider/model]"
                    fi
                    ;;
                --villager-model)
                    if [ -n "$2" ]; then
                        set_role_model "VILLAGER" "$2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --villager-model [provider/model]"
                    fi
                    ;;
                --town-model)
                    if [ -n "$2" ]; then
                        set_role_model "DOCTOR" "$2"
                        set_role_model "SHERIFF" "$2"
                        set_role_model "VIGILANTE" "$2"
                        set_role_model "VILLAGER" "$2"
                        echo "✅ Town models set to $2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --town-model [provider/model]"
                    fi
                    ;;
                --player-model)
                    if [ -n "$2" ] && [ -n "$3" ]; then
                        set_player_model "$2" "$3"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --player-model [index] [provider/model]"
                    fi
                    ;;
                --range-model)
                    if [ -n "$2" ] && [ -n "$3" ] && [ -n "$4" ]; then
                        set_range_model "$2" "$3" "$4"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --range-model [start] [end] [provider/model]"
                    fi
                    ;;
                --preset)
                    if [ -n "$2" ]; then
                        apply_preset "$2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --preset [preset-name]"
                        echo "   Available presets:"
                        echo "   • gpt4VsClaude  - GPT-4 for Mafia, Claude-3 for Town"
                        echo "   • varying       - Different strength for different roles"
                        echo "   • experimental  - Rotate through different models"
                        echo "   • allGpt4       - All players use GPT-4"
                        echo "   • allClaude     - All players use Claude-3 Opus"
                    fi
                    ;;
                --save)
                    if [ -n "$2" ]; then
                        cp "$CONFIG_FILE" "$2"
                        echo "✅ Configuration saved to $2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --save [filename.json]"
                    fi
                    ;;
                --load)
                    if [ -n "$2" ] && [ -f "$2" ]; then
                        cp "$2" "$CONFIG_FILE"
                        echo "✅ Configuration loaded from $2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --load [filename.json]"
                    fi
                    ;;
                --total-players)
                    if [ -n "$2" ]; then
                        local config=$(load_player_config)
                        config=$(echo "$config" | sed "s/\"totalPlayers\"[[:space:]]*:[[:space:]]*[0-9]*/\"totalPlayers\": $2/")
                        save_player_config "$config"
                        echo "✅ Total players set to $2"
                    else
                        echo "❌ Usage: ./mafia.sh config-players --total-players [count]"
                    fi
                    ;;
                --help|-h)
                    echo ""
                    echo "🎛️  PLAYER MODEL CONFIGURATION"
                    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
                    echo ""
                    echo "USAGE: ./mafia.sh config-players [OPTIONS]"
                    echo ""
                    echo "VIEW & MANAGE:"
                    echo "  --show, -s             Display current configuration"
                    echo "  --reset                Reset to default settings"
                    echo ""
                    echo "ROLE-BASED ASSIGNMENTS:"
                    echo "  --mafia-model [model]      Set model for all Mafia"
                    echo "  --doctor-model [model]     Set model for Doctor"
                    echo "  --sheriff-model [model]    Set model for Sheriff"
                    echo "  --vigilante-model [model]  Set model for Vigilante"
                    echo "  --villager-model [model]   Set model for Villagers"
                    echo "  --town-model [model]       Set model for all Town roles"
                    echo ""
                    echo "PLAYER-SPECIFIC ASSIGNMENTS:"
                    echo "  --player-model [n] [model] Set model for specific player"
                    echo "  --range-model [s] [e] [m]  Set model for players s-e"
                    echo ""
                    echo "PRESETS:"
                    echo "  --preset gpt4VsClaude  GPT-4 (Mafia) vs Claude-3 (Town)"
                    echo "  --preset varying       Different strength by role"
                    echo "  --preset experimental  Rotate through different models"
                    echo "  --preset allGpt4       All players use GPT-4"
                    echo "  --preset allClaude     All players use Claude-3 Opus"
                    echo ""
                    echo "GAME SETTINGS:"
                    echo "  --total-players [n]    Set total player count"
                    echo "  --save [file.json]     Save config to file"
                    echo "  --load [file.json]     Load config from file"
                    echo ""
                    echo "EXAMPLES:"
                    echo "  ./mafia.sh config-players --show"
                    echo "  ./mafia.sh config-players --mafia-model openai/gpt-4"
                    echo "  ./mafia.sh config-players --player-model 1 openai/gpt-4o"
                    echo "  ./mafia.sh config-players --range-model 1 50 openai/gpt-4o-mini"
                    echo "  ./mafia.sh config-players --preset gpt4VsClaude"
                    echo ""
                    ;;
                *)
                    echo "❌ Unknown option: $1"
                    echo "   Run: ./mafia.sh config-players --help"
                    ;;
            esac
        fi
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo "   Use: ./mafia.sh config-players [options]"
        echo "   Or:   ./mafia.sh help"
        ;;
esac
