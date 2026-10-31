import React from "react";
import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { Metadata } from "next";
import { BOOKS, getBookById } from "@/data/books";
import { getRelatedBooksWithReasons } from "@/lib/recommendations";
import BookDetailClient from "./BookDetailClient";
import { getAffiliateInfoForBook } from "@/lib/affiliate-config";

interface BookPageProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams() {
  return BOOKS.map((book) => ({
    id: book.id,
  }));
}

export async function generateMetadata({
  params,
}: BookPageProps): Promise<Metadata> {
  const resolvedParams = await params;
  const book = getBookById(resolvedParams.id);
  if (!book) {
    return {
      title: "Book Not Found | Reader's HUB",
    };
  }

  return {
    title: `${book.title} by ${book.author}`,
    description: book.description.slice(0, 160),
    openGraph: {
      title: `${book.title} | Reader's HUB`,
      description: book.description.slice(0, 160),
      images: [
        {
          url: book.cover,
          alt: book.title,
        },
      ],
    },
  };
}

export default async function BookPage({ params }: BookPageProps) {
  const resolvedParams = await params;
  const book = getBookById(resolvedParams.id);

  if (!book) {
    notFound();
  }

  // "More by {author}" on the page already lists the first four same-author books, so similar books add something new
  const shownByAuthor = new Set(BOOKS.filter((b) => b.author === book.author && b.id !== book.id).slice(0, 4).map((b) => b.id));
  const related = getRelatedBooksWithReasons(book, BOOKS.filter((b) => !shownByAuthor.has(b.id)), 4);
  const affiliateInfo = getAffiliateInfoForBook(book);

  return <BookDetailClient book={book} relatedBooks={related.map((r) => r.book)} relatedReasons={Object.fromEntries(related.map((r) => [r.book.id, r.reason]))} affiliateInfo={affiliateInfo} />;
}

