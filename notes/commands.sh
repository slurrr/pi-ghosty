map config

rg -n "agents\\[|tools\\b|projectTag|hindsight|vllm" pi-agent.json src/config src/pi/createSession.ts 


tmux and shit
~
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
                                                                                                                                
 Coordinator (latest):                                                                                                          
                                                                                                                                
 ```bash                                                                                                                        
   tail -F "$(ls -t ~/runs/pi-ghosty/data/traces/coordinator/*.jsonl | head -n 1)"                                              
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