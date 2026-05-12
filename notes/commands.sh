memory

check retain mission

curl -X PATCH http://localhost:8888/v1/default/banks/pi-ghosty-procedural/config \
-H "Content-Type: application/json" \
-d '{
  "updates": {
    "retain_mission": "test"
  }
}'
  
directly list the extracted facts and the consolidated observations via the HTTP API:              
                                                                                                                 
 1) list raw extracted facts (world/experience)                                                                  
                                                                                                                 
 ```bash                                                                                                         
   curl -sS 'http://localhost:8888/v1/default/banks/pi-ghosty/memories/list?limit=20&offset=0'                   
 ```                                                                                                             
                                                                                                                 
 2) list just consolidated observations (this is the heavy part)                                                 
                                                                                                                 
 ```bash                                                                                                         
   curl -sS 'http://localhost:8888/v1/default/banks/pi-ghosty/observations?limit=20&offset=0'                    
 ```                                                                                                             
                                                                                                                 
 3) sanity check per-document growth (are we exploding memory units?)                                            
                                                                                                                 
 ```bash                                                                                                         
   curl -sS 'http://localhost:8888/v1/default/banks/pi-ghosty/documents?limit=50&offset=0'                       
 ```                                                                                                             
     

map config

rg -n "agents\\[|tools\\b|projectTag|hindsight|vllm" pi-agent.json src/config src/pi/createSession.ts 

Confirm each agent’s resolved sampling via:         
                                                                                                          
 ```bash                                                                                                  
   rg -n '"type":"sampling_config"' ~/runs/pi-ghosty/data/traces/*/*.jsonl | tail -n 50                   
 ```  

tmux and shit

 1. Start tmux session:                                                                                                         
 ```bash                                                                                                                        
   tmux new -s ghosty                                                                                                           
 ```                                                                                                                            
                                                                                                                                
 2. Window 0: run the TUI                                                                                                       
 ```bash                                                                                                                        
   cd ~/code/dev/pi-ghosty                                                                                                      
   npm run dev                                                                                                                  
 ```                                                                                                                            
                                                                                                                                
 3. Window 1: “watch traces” (split into panes)                                                                                 
 Create new window:                                                                                                             
 - Ctrl-b c                                                                                                                     
                                                                                                                                
 Split into 4 panes:                                                                                                            
 - Ctrl-b % (split vertical)                                                                                                    
 - Ctrl-b " (split horizontal)                                                                                                  
 - move to other pane (Ctrl-b + arrow), split again, etc.                                                                       
                                                                                                                                
 In each pane, tail the latest file for that agent. For example:  

Runtime delegations (latest):
                                                                                                                                
 ```bash                                                                                                                        
   tail -F "$(ls -t ~/runs/pi-ghosty/data/traces/runtime/*.jsonl | head -n 1)"                                                  
 ```                                                                                                                            
                                                                                                                                
 Corroborator (latest):                                                                                                          
                                                                                                                                
 ```bash                                                                                                                        
   tail -F "$(ls -t ~/runs/pi-ghosty/data/traces/corroborator/*.jsonl | head -n 1)"                                              
 ```                                                                                                                            
                                                                                                                                
 Researcher (latest):                                                                                                           
                                                                                                                                
 ```bash                                                                                                                        
   tail -F "$(ls -t ~/runs/pi-ghosty/data/traces/researcher/*.jsonl | head -n 1)"                                               
 ```                                                                                                                            
                                                                                                                                
 Coder (latest):                                                                                                                
                                                                                                                                
 ```bash                                                                                                                        
   tail -F "$(ls -t ~/runs/pi-ghosty/data/traces/coder/*.jsonl | head -n 1)"                                                    
 ```                                                                                                                            
      


 ### One-liner (workers only)                                                                                                   
                                                                                                                                
 ```bash                                                                                                                        
   tail -n 0 -F -v ~/runs/pi-ghosty/data/traces/{coder,researcher,reviewer,memory}/*.jsonl                                      
 ```                                                                                                                            
                                                                                                                                
 - -v makes tail print ==> filename <== separators when it switches files, which is the easiest way to see “who said this”      
 without extra tooling.                                                                                                         
 - -n 0 means “only new lines”.                                                                                                 
                                                                                                                                
 ### If you also want runtime delegations in the same stream                                                                    
                                                                                                                                
 ```bash                                                                                                                        
   tail -n 0 -F -v \                                                                                                            
     ~/runs/pi-ghosty/data/traces/runtime/*.jsonl \                                                                             
     ~/runs/pi-ghosty/data/traces/{coder,researcher,reviewer,memory}/*.jsonl                                                    
 ```                                                                              