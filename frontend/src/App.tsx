import { useStream } from "@langchain/langgraph-sdk/react";
import type { Message } from "@langchain/langgraph-sdk";
import { useState, useEffect, useRef, useCallback } from "react";
import { ProcessedEvent } from "@/components/ActivityTimeline";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ChatMessagesView } from "@/components/ChatMessagesView";
import { useLlmContext } from "@/contexts/LlmContext";

// Image data interface to match backend structure
interface ImageData {
  url: string;
  title: string;
  source: string;
  alt: string;
}

export default function App() {
  const { provider, model } = useLlmContext();
  const [processedEventsTimeline, setProcessedEventsTimeline] = useState<
    ProcessedEvent[]
  >([]);
  const [historicalActivities, setHistoricalActivities] = useState<
    Record<string, ProcessedEvent[]>
  >({});
  const [allImages, setAllImages] = useState<ImageData[]>([]); // State for collecting images
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const hasFinalizeEventOccurredRef = useRef(false);

  const thread = useStream<{
    messages: Message[];
    initial_search_query_count: number;
    max_research_loops: number;
    reasoning_model: string;
    provider: string;
  }>({
    apiUrl: import.meta.env.DEV
      ? "http://localhost:2024"
      : "http://localhost:8123",
    assistantId: "agent",
    messagesKey: "messages",
    onFinish: (event: any) => {
      console.log('Finish event:', event);
    },
    onUpdateEvent: (event: any) => {
      console.log('Received event:', event);
      let processedEvent: ProcessedEvent | null = null;
      
      try {
        if (event?.messages?.[0]?.content) {
          // Handle message content
          const content = event.messages[0].content;
          processedEvent = {
            title: "Response",
            data: Array.isArray(content) ? content.join("\n") : String(content),
          };
        } else if (event?.generate_query?.query_list) {
          const queryList = event.generate_query.query_list;
          processedEvent = {
            title: "Generating Search Queries",
            data: Array.isArray(queryList) ? queryList.join(", ") : String(queryList),
          };
        } else if (event?.web_research) {
          const sources = event.web_research.sources_gathered || [];
          const images = event.web_research.images || []; // Extract images from web research
          const numSources = sources.length;
          const uniqueLabels = [
            ...new Set(sources.map((s: any) => s?.label).filter(Boolean)),
          ];
          const exampleLabels = uniqueLabels.slice(0, 3).join(", ");
          
          // Add new images to the collection
          if (images.length > 0) {
            setAllImages(prevImages => {
              // Filter out duplicates based on URL
              const existingUrls = new Set(prevImages.map(img => img.url));
              const newImages = images.filter((img: ImageData) => !existingUrls.has(img.url));
              return [...prevImages, ...newImages];
            });
            
            processedEvent = {
              title: "Web Research",
              data: `Gathered ${numSources} sources and ${images.length} images. Related to: ${
                exampleLabels || "N/A"
              }.`,
            };
          } else {
            processedEvent = {
              title: "Web Research",
              data: `Gathered ${numSources} sources. Related to: ${
                exampleLabels || "N/A"
              }.`,
            };
          }
        } else if (event?.reflection) {
          const followUpQueries = event.reflection.follow_up_queries;
          processedEvent = {
            title: "Reflection",
            data: event.reflection.is_sufficient
              ? "Search successful, generating final answer."
              : `Need more information, searching for ${
                  Array.isArray(followUpQueries) 
                    ? followUpQueries.join(", ") 
                    : followUpQueries || "additional information"
                }`,
          };
        } else if (event?.finalize_answer) {
          processedEvent = {
            title: "Finalizing Answer",
            data: "Composing and presenting the final answer.",
          };
          hasFinalizeEventOccurredRef.current = true;
        }

        if (processedEvent) {
          setProcessedEventsTimeline((prevEvents) => [
            ...prevEvents,
            processedEvent!,
          ]);
        }
      } catch (error) {
        console.error('Error processing event:', error, event);
      }
    },
  });

  useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollViewport = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]"
      );
      if (scrollViewport) {
        scrollViewport.scrollTop = scrollViewport.scrollHeight;
      }
    }
  }, [thread.messages]);

  useEffect(() => {
    if (
      hasFinalizeEventOccurredRef.current &&
      !thread.isLoading &&
      thread.messages.length > 0
    ) {
      const lastMessage = thread.messages[thread.messages.length - 1];
      if (lastMessage && lastMessage.type === "ai" && lastMessage.id) {
        setHistoricalActivities((prev) => ({
          ...prev,
          [lastMessage.id!]: [...processedEventsTimeline],
        }));
      }
      hasFinalizeEventOccurredRef.current = false;
    }
  }, [thread.messages, thread.isLoading, processedEventsTimeline]);

  const handleSubmit = useCallback(
    (submittedInputValue: string, effort: string) => {
      if (!submittedInputValue.trim()) return;
      setProcessedEventsTimeline([]);
      setAllImages([]); // Clear images for new conversation
      hasFinalizeEventOccurredRef.current = false;

      // convert effort to, initial_search_query_count and max_research_loops
      // low means max 1 loop and 1 query
      // medium means max 3 loops and 3 queries
      // high means max 10 loops and 5 queries
      let initial_search_query_count = 0;
      let max_research_loops = 0;
      switch (effort) {
        case "low":
          initial_search_query_count = 1;
          max_research_loops = 1;
          break;
        case "medium":
          initial_search_query_count = 3;
          max_research_loops = 3;
          break;
        case "high":
          initial_search_query_count = 5;
          max_research_loops = 10;
          break;
      }

      const newMessages: Message[] = [
        ...(thread.messages || []),
        {
          type: "human",
          content: submittedInputValue,
          id: Date.now().toString(),
        },
      ];
      thread.submit({
        messages: newMessages,
        initial_search_query_count: initial_search_query_count,
        max_research_loops: max_research_loops,
        reasoning_model: model,
        provider: provider,
      });
    },
    [thread, provider, model]
  );

  const handleCancel = useCallback(() => {
    thread.stop();
    window.location.reload();
  }, [thread]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Fixed Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-900 via-purple-900/20 to-slate-900 pointer-events-none" />
      
      {/* Main Container */}
      <main className="relative flex-1 flex flex-col max-w-5xl mx-auto w-full p-4">
        {/* Content Area - Fixed Frame */}
        <div className="flex-1 flex flex-col min-h-0">
          {thread.messages.length === 0 ? (
            <WelcomeScreen
              handleSubmit={handleSubmit}
              isLoading={thread.isLoading}
              onCancel={handleCancel}
            />
          ) : (
            <ChatMessagesView
              messages={thread.messages}
              isLoading={thread.isLoading}
              scrollAreaRef={scrollAreaRef}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              liveActivityEvents={processedEventsTimeline}
              historicalActivities={historicalActivities}
              allImages={allImages} // Pass the collected images
            />
          )}
        </div>
      </main>
    </div>
  );
}
