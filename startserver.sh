#!/bin/bash

# 1. Navigate to the script's directory
cd "$(dirname "$(realpath "$0")")"

# 2. Define a function to check permissions
check_file_permission() {
    local var_name=$1
    local env_file=$2
    
    # Extract the file path
    # grep finds the line, cut extracts value, tr removes quotes
    local file_path=$(grep "^${var_name}=" "$env_file" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'")

    # Only proceed if a path was found
    if [ -n "$file_path" ]; then
        # Check if file is readable (-r) by the current user
        if [ ! -r "$file_path" ]; then
            local parent_dir=$(dirname "$file_path")
            
            # Print error to stderr
            >&2 echo "❌ ERROR: Permission denied for $var_name"
            >&2 echo "   File: $file_path"
            >&2 echo "   Current User: $USER"
            >&2 echo ""
            >&2 echo "   The server cannot read this file. Please run the following"
            >&2 echo "   commands manually to grant access:"
            >&2 echo ""
            >&2 echo "   # 1. Allow access to the file"
            >&2 echo "   sudo setfacl -L -m u:$USER:r $file_path"
            >&2 echo ""
            >&2 echo "   # 2. Allow access to the parent directory"
            >&2 echo "   sudo setfacl -L -m u:$USER:rx $parent_dir"
            >&2 echo ""
            
            # Special hint for Let's Encrypt users
            if [[ "$file_path" == *"/letsencrypt/"* ]]; then
                 >&2 echo "   # 3. If using Let's Encrypt, unblock top-level folders:"
                 >&2 echo "   sudo setfacl -m u:$USER:rx /etc/letsencrypt/live"
                 >&2 echo "   sudo setfacl -m u:$USER:rx /etc/letsencrypt/archive"
                 >&2 echo ""
            fi
            
            exit 1
        else
            echo "✅ Verified access to $var_name"
        fi
    fi
}

# 3. Run the check for .env and .env.local
echo "🔍 Checking configuration file permissions..."
for env_file in ".env" ".env.local"; do
    if [ -f "$env_file" ]; then
        check_file_permission "TO_KEY_FILE" "$env_file"
        check_file_permission "TO_CERT_FILE" "$env_file"
        check_file_permission "TO_CLIENTS_FILE" "$env_file"
    fi
done

# 4. Start the server
echo "🚀 Starting TunnelOut Server as $USER..."
node -r esm bin/server "$@"
