#!/usr/bin/env python3
"""
OpenRouter Models Parser
Extracts and organizes model information from models.dev API JSON
"""

import json
import os

def parse_openrouter_models(json_path: str) -> dict:
    """Parse OpenRouter models JSON and organize by provider"""
    
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    providers = {}
    
    for provider_id, provider_info in data.items():
        if not isinstance(provider_info, dict):
            continue
            
        provider_name = provider_info.get('name', provider_id)
        provider_api = provider_info.get('api', '')
        provider_doc = provider_info.get('doc', '')
        
        models = {}
        
        for model_id, model_info in provider_info.get('models', {}).items():
            if not isinstance(model_info, dict):
                continue
                
            models[model_id] = {
                'id': model_info.get('id', model_id),
                'name': model_info.get('name', model_id),
                'family': model_info.get('family', ''),
                'context_limit': model_info.get('limit', {}).get('context', 0),
                'output_limit': model_info.get('limit', {}).get('output', 0),
                'knowledge_cutoff': model_info.get('knowledge', ''),
                'release_date': model_info.get('release_date', ''),
                'reasoning': model_info.get('reasoning', False),
                'tool_call': model_info.get('tool_call', False),
                'temperature': model_info.get('temperature', False),
                'cost_input': model_info.get('cost', {}).get('input', 0),
                'cost_output': model_info.get('cost', {}).get('output', 0),
            }
        
        if models:
            providers[provider_id] = {
                'id': provider_id,
                'name': provider_name,
                'api': provider_api,
                'doc': provider_doc,
                'model_count': len(models),
                'models': models,
            }
    
    return providers

def print_provider_summary(providers: dict):
    """Print summary of providers and their models"""
    
    # Sort by model count
    sorted_providers = sorted(providers.values(), key=lambda x: x['model_count'], reverse=True)
    
    print("=" * 80)
    print("OPENROUTER MODELS SUMMARY")
    print("=" * 80)
    print(f"Total Providers: {len(providers)}")
    print()
    
    for provider in sorted_providers:
        print(f"\n{provider['name']} ({provider['id']})")
        print(f"  API: {provider['api']}")
        print(f"  Models: {provider['model_count']}")
        print(f"  Doc: {provider['doc']}")
        
        # Print top 5 models by context length
        models_sorted = sorted(
            provider['models'].values(), 
            key=lambda x: x['context_limit'], 
            reverse=True
        )[:5]
        
        print("  Top Models:")
        for model in models_sorted:
            context_mb = model['context_limit'] / 1024 if model['context_limit'] > 0 else 0
            print(f"    - {model['name']}")
            print(f"      Context: {context_mb:.0f}K tokens")
            print(f"      Reasoning: {model['reasoning']}, Tools: {model['tool_call']}")
            print(f"      Cost: ${model['cost_input']:.3f}/${model['cost_output']:.3f} per 1M tokens")

def extract_key_providers(providers: dict) -> dict:
    """Extract key providers that should be in Mafia AI Benchmark"""
    
    key_providers = {}
    key_provider_ids = {
        'openai', 'anthropic', 'google', 'deepseek', 'groq', 
        'meta', 'xai', 'moonshotai', 'qwen', 'ollama', 'lm-studio'
    }
    
    for provider_id in key_provider_ids:
        if provider_id in providers:
            key_providers[provider_id] = providers[provider_id]
        # Also check for variations
        for full_id, provider in providers.items():
            if provider_id in full_id.lower():
                key_providers[full_id] = provider
    
    return key_providers

def generate_provider_configs(providers: dict):
    """Generate provider configuration for Mafia AI Benchmark"""
    
    configs = []
    
    provider_mapping = {
        'openai': ('OPENAI', 'gpt-5.1'),
        'anthropic': ('ANTHROPIC', 'claude-sonnet-4'),
        'google': ('GOOGLE', 'gemini-2.5-pro'),
        'deepseek': ('DEEPSEEK', 'deepseek-chat'),
        'groq': ('GROQ', 'llama2-70b-4096'),
        'meta': ('META', 'llama-4-scout'),
        'xai': ('XAI', 'grok-4'),
        'moonshotai': ('MOONSHOT', 'kimi-k2-thinking'),
        'qwen': ('QWEN', 'qwen3-235b-a22b-instruct'),
        'ollama': ('OLLAMA', 'llama2'),
        'lm-studio': ('LM_STUDIO', 'llama-2-7b-chat'),
    }
    
    for provider_id, provider in providers.items():
        if provider_id in provider_mapping:
            mafia_name, default_model = provider_mapping[provider_id]
            
            # Find best model (highest context)
            best_model = max(provider['models'].values(), key=lambda x: x['context_limit'])
            
            config = {
                'mafia_provider': mafia_name,
                'original_id': provider_id,
                'name': provider['name'],
                'api': provider['api'],
                'default_model': default_model,
                'best_model': best_model['name'],
                'best_model_context': best_model['context_limit'],
                'total_models': provider['model_count'],
            }
            configs.append(config)
    
    return configs

def main():
    json_path = '/config/workspace/mafia/openrouter_models.json'
    
    if not os.path.exists(json_path):
        print(f"Error: File not found: {json_path}")
        return
    
    print("Parsing OpenRouter models JSON...")
    providers = parse_openrouter_models(json_path)
    
    print_provider_summary(providers)
    
    print("\n" + "=" * 80)
    print("KEY PROVIDERS FOR MAFIA AI BENCHMARK")
    print("=" * 80)
    
    key_providers = extract_key_providers(providers)
    configs = generate_provider_configs(key_providers)
    
    for config in configs:
        print(f"\n{config['name']}")
        print(f"  Mafia Provider: {config['mafia_provider']}")
        print(f"  API: {config['api']}")
        print(f"  Default Model: {config['default_model']}")
        print(f"  Best Model: {config['best_model']} ({config['best_model_context']} context)")
        print(f"  Total Models: {config['total_models']}")
    
    # Save detailed report
    report = {
        'summary': {
            'total_providers': len(providers),
            'key_providers': len(key_providers),
        },
        'providers': key_providers,
        'configs': configs,
    }
    
    with open('/config/workspace/mafia/openrouter_models_report.json', 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    print(f"\nDetailed report saved to: /config/workspace/mafia/openrouter_models_report.json")

if __name__ == '__main__':
    main()
